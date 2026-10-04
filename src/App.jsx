import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Chess } from "chess.js";
import "./App.css";

const pieceSymbols = {
  w: {
    p: "♙",
    n: "♘",
    b: "♗",
    r: "♖",
    q: "♕",
    k: "♔",
  },
  b: {
    p: "♟",
    n: "♞",
    b: "♝",
    r: "♜",
    q: "♛",
    k: "♚",
  },
};

function classifyMove(loss) {
  if (loss >= 2.0) {
    return {
      label: "Blunder",
      symbol: "??",
      className: "blunder",
    };
  }

  if (loss >= 0.8) {
    return {
      label: "Mistake",
      symbol: "?",
      className: "mistake",
    };
  }

  if (loss <= 0.2) {
    return {
      label: "Great Move",
      symbol: "!",
      className: "great",
    };
  }

  return {
    label: "Good",
    symbol: "",
    className: "good",
  };
}

function createRoot() {
  return {
    id: "root",
    parentId: null,
    fen: new Chess().fen(),
    move: null,
    children: [],
  };
}

function App() {
  // =====================================================
  // GAME TREE
  // =====================================================

  const [tree, setTree] = useState(() => ({
    root: createRoot(),
  }));

  const [currentNodeId, setCurrentNodeId] =
    useState("root");

  // =====================================================
  // BOARD
  // =====================================================

  const [selectedSquare, setSelectedSquare] =
    useState(null);

  const [promotion, setPromotion] =
    useState(null);
// =======================================================
// OPENING DETECTOR
// =======================================================
    const [openingInfo, setOpeningInfo] = useState({
  name: "Unknown Opening",
  variation: "",
});

  // =====================================================
  // STOCKFISH
  // =====================================================

  const [evaluation, setEvaluation] =
    useState(0);

  const [engineReady, setEngineReady] =
    useState(false);

  const stockfishRef = useRef(null);
  const gameRef = useRef(null);
  const evaluationRef = useRef(0);
  const pendingMoveRef = useRef(null);
  const pgnAnalysisQueueRef = useRef([]);
  const pgnAnalysisActiveRef = useRef(false);
  const pgnAnalysisScoreRef = useRef(null);

  // =====================================================
  // UNDO / REDO
  // =====================================================

  const [undoStack, setUndoStack] =
    useState([]);

  const [redoStack, setRedoStack] =
    useState([]);

  // =====================================================
  // CONTEXT MENU
  // =====================================================

  const [contextMenu, setContextMenu] =
    useState(null);

  // =====================================================
  // CURRENT POSITION
  // =====================================================

  const currentNode =
    tree[currentNodeId] || tree.root;

  const game = useMemo(
    () => new Chess(currentNode.fen),
    [currentNode.fen]
  );

  const board = game.board();

  const firstThreeMoves = [
    { from: "e2", to: "e4" },
    { from: "e7", to: "e5" },
    { from: "g1", to: "f3" },
  ];

  function getArrowPoint(square) {
    const files = "abcdefgh";
    const file = files.indexOf(square[0]);
    const rank = parseInt(square[1], 10);

    return {
      x: file * 100 + 50,
      y: (8 - rank) * 100 + 50,
    };
  }

  useEffect(() => {
    gameRef.current = game;
  }, [game]);

  const evaluationGraphData = [];

function addEvaluationNodes(nodeId) {
  const node = tree[nodeId];

  if (!node) {
    return;
  }

  if (node.move && node.evaluationAfter !== null) {
    evaluationGraphData.push({
      move: node.move.moveNumber,
      evaluation: node.evaluationAfter,
    });
  }

  node.children.forEach((childId) => {
    addEvaluationNodes(childId);
  });
}

addEvaluationNodes("root");

  useEffect(() => {
    evaluationRef.current = evaluation;
  }, [evaluation]);

  // =====================================================
  // STOCKFISH
  // =====================================================

  useEffect(() => {
    const worker = new Worker(
      `${import.meta.env.BASE_URL}stockfish-19-lite-single.js`
    );

    stockfishRef.current = worker;

    worker.onmessage = (event) => {
      const message = event.data;

      if (typeof message !== "string") {
        return;
      }

      if (message === "readyok") {
        setEngineReady(true);
        return;
      }

      let score = null;

      const cpMatch =
        message.match(/score cp (-?\d+)/);

      if (cpMatch) {
        score =
          parseInt(cpMatch[1], 10) / 100;
      } else {
        const mateMatch =
          message.match(/score mate (-?\d+)/);

        if (mateMatch) {
          const mateIn =
            parseInt(mateMatch[1], 10);

          score =
            mateIn > 0 ? 10 : -10;
        }
      }

      // =================================================
      // PGN ANALYSIS
      // =================================================

      const queuedPGN =
        pgnAnalysisQueueRef.current[0];

      if (
        queuedPGN &&
        pgnAnalysisActiveRef.current
      ) {
        if (score !== null) {
          const queuedGame =
            new Chess(queuedPGN.fen);

          let whiteScore = score;

          if (queuedGame.turn() === "b") {
            whiteScore = -whiteScore;
          }

          pgnAnalysisScoreRef.current =
            whiteScore;
        }

        if (message.startsWith("bestmove")) {
          const finalScore =
            pgnAnalysisScoreRef.current;

          if (finalScore !== null) {
            // First analyze the position BEFORE the move.
            if (queuedPGN.phase === "before") {
              queuedPGN.beforeEvaluation =
                finalScore;

              pgnAnalysisScoreRef.current = null;
              queuedPGN.phase = "after";

              worker.postMessage("stop");
              worker.postMessage(
                `position fen ${queuedPGN.afterFen}`
              );
              worker.postMessage("go depth 12");

              return;
            }

            // Then analyze the position AFTER the move.
            if (queuedPGN.phase === "after") {
              const before =
                queuedPGN.beforeEvaluation;

              const after =
                finalScore;

              let loss;

              if (queuedPGN.color === "w") {
                loss = before - after;
              } else {
                loss = after - before;
              }

              loss = Math.max(0, loss);

              const classification =
                classifyMove(loss);

              setTree((oldTree) => {
                const node =
                  oldTree[queuedPGN.nodeId];

                if (!node) {
                  return oldTree;
                }

                return {
                  ...oldTree,
                  [queuedPGN.nodeId]: {
                    ...node,
                    evaluationBefore: before,
                    evaluationAfter: after,
                    loss,
                    classification,
                    analyzing: false,
                  },
                };
              });

              setEvaluation(after);
            }
          }

          pgnAnalysisQueueRef.current.shift();
          pgnAnalysisScoreRef.current = null;

          if (
            pgnAnalysisQueueRef.current.length > 0
          ) {
            setTimeout(() => {
              startNextPGNAnalysis();
            }, 0);
          } else {
            pgnAnalysisActiveRef.current = false;
            console.log(
              "PGN analysis complete!"
            );
          }
        }

        return;
      }

      // No score yet for the normal current-position analysis.
      if (score === null) {
        return;
      }

      if (gameRef.current?.turn() === "b") {
        score = -score;
      }

      setEvaluation(score);

      // =================================================
      // CLASSIFY MOVE
      // =================================================

      const pending =
        pendingMoveRef.current;

      if (
        pending &&
        gameRef.current?.fen() ===
          pending.afterFen
      ) {
        const before =
          pending.beforeEvaluation;

        const movedColor =
          pending.color;

        let loss;

        if (movedColor === "w") {
          loss = before - score;
        } else {
          loss = score - before;
        }

        loss = Math.max(0, loss);

        const classification =
          classifyMove(loss);

        setTree((oldTree) => {
          const node =
            oldTree[pending.nodeId];

          if (!node) {
            return oldTree;
          }

          return {
            ...oldTree,

            [pending.nodeId]: {
              ...node,

              evaluationBefore:
                before,

              evaluationAfter:
                score,

              loss,

              classification,

              analyzing: false,
            },
          };
        });

        pendingMoveRef.current = null;
      }
    };

    worker.postMessage("uci");
    worker.postMessage("isready");

    return () => {
      pgnAnalysisQueueRef.current = [];
      pgnAnalysisActiveRef.current = false;
      pgnAnalysisScoreRef.current = null;
      worker.terminate();
      stockfishRef.current = null;
    };
  }, []);

  // =====================================================
  // ANALYZE CURRENT POSITION
  // =====================================================

  useEffect(() => {
    if (!engineReady) {
      return;
    }

    if (pgnAnalysisQueueRef.current.length > 0) {
      if (!pgnAnalysisActiveRef.current) {
        startNextPGNAnalysis();
      }
      return;
    }

    const worker =
      stockfishRef.current;

    if (!worker) {
      return;
    }

    pendingMoveRef.current = null;

    worker.postMessage("stop");

    worker.postMessage(
      `position fen ${currentNode.fen}`
    );
    worker.postMessage("go depth 12");
  }, [
    currentNodeId,
    currentNode.fen,
    engineReady,
  ]);

  // =====================================================
  // CLOSE CONTEXT MENU
  // =====================================================

  useEffect(() => {
    const closeMenu = () => {
      setContextMenu(null);
    };

    window.addEventListener(
      "click",
      closeMenu
    );

    return () => {
      window.removeEventListener(
        "click",
        closeMenu
      );
    };
  }, []);

  // =====================================================
  // BOARD HELPERS
  // =====================================================

  function squareName(row, col) {
    const files = "abcdefgh";

    return `${files[col]}${8 - row}`;
  }

  function isLegalMove(square) {
    if (!selectedSquare) {
      return false;
    }

    const moves = game.moves({
      square: selectedSquare,
      verbose: true,
    });

    return moves.some(
      (move) => move.to === square
    );
  }

  function getLastMove() {
    if (!currentNode.move) {
      return null;
    }

    return {
      from: currentNode.move.from,
      to: currentNode.move.to,
    };
  }

  // =====================================================
  // NAVIGATION
  // =====================================================

  function goToNode(nodeId) {
    if (!tree[nodeId]) {
      return;
    }

    pendingMoveRef.current = null;

    setCurrentNodeId(nodeId);
    setSelectedSquare(null);
    setPromotion(null);
    setContextMenu(null);
  }

  function handlePreviousMove() {
    if (!currentNode.parentId) {
      return;
    }

    goToNode(currentNode.parentId);
  }

  function handleNextMove() {
    if (
      currentNode.children.length === 0
    ) {
      return;
    }

    // Follow main variation
    goToNode(
      currentNode.children[0]
    );
  }
// PGN Inport

function startNextPGNAnalysis() {
  const worker = stockfishRef.current;

  if (!worker) {
    return;
  }

  const item =
    pgnAnalysisQueueRef.current[0];

  if (!item) {
    pgnAnalysisActiveRef.current = false;
    return;
  }

  pgnAnalysisActiveRef.current = true;
  pgnAnalysisScoreRef.current = null;
  item.phase = "before";
  item.beforeEvaluation = null;

  worker.postMessage("stop");
  worker.postMessage(
    `position fen ${item.beforeFen}`
  );
  worker.postMessage("go depth 12");
}

function handlePGNImport(event) {
  const file = event.target.files?.[0];

  if (!file) {
    return;
  }

  const reader = new FileReader();

  reader.onload = () => {
    const pgn = String(reader.result || "");

    try {
      const pgnGame = new Chess();
      pgnGame.loadPgn(pgn);

      const moves = pgnGame.history({
        verbose: true,
      });

      if (moves.length === 0) {
        throw new Error("No moves found in PGN.");
      }

      const replayGame = new Chess();

      const newTree = {
        root: {
          id: "root",
          parentId: null,
          fen: replayGame.fen(),
          move: null,
          children: [],
        },
      };

      const analysisQueue = [];
      let parentId = "root";

      moves.forEach((move, index) => {
        const beforeFen = replayGame.fen();

        const playedMove = replayGame.move({
          from: move.from,
          to: move.to,
          promotion: move.promotion,
        });

        const afterFen = replayGame.fen();
        const nodeId = `pgn-${Date.now()}-${index}`;

        const node = {
          id: nodeId,
          parentId,
          fen: afterFen,

          move: {
            from: move.from,
            to: move.to,
            promotion: move.promotion,
            san: playedMove.san,
            color: move.color,
            moveNumber: Math.ceil((index + 1) / 2),
          },

          children: [],
          evaluationBefore: null,
          evaluationAfter: null,
          loss: null,
          classification: null,
          analyzing: true,
          beforeFen,
          afterFen,
        };

        newTree[nodeId] = node;
        newTree[parentId].children = [
          ...newTree[parentId].children,
          nodeId,
        ];

        analysisQueue.push({
          nodeId,
          fen: afterFen,
          beforeFen,
          afterFen,
          color: move.color,
          phase: "before",
          beforeEvaluation: null,
        });

        parentId = nodeId;
      });

      pgnAnalysisQueueRef.current = analysisQueue;
      pgnAnalysisActiveRef.current = false;
      pgnAnalysisScoreRef.current = null;

      // Detect the opening of the imported PGN.
      const importedOpening = detectOpening(
        moves.map((move) => move.san)
      );

      setOpeningInfo(importedOpening);

      setTree(newTree);
      setCurrentNodeId(parentId);
      setUndoStack([]);
      setRedoStack([]);
      setEvaluation(0);
      setSelectedSquare(null);
      setPromotion(null);
      pendingMoveRef.current = null;

      if (engineReady) {
        startNextPGNAnalysis();
      }

      alert(
        `PGN loaded successfully!\n\n${moves.length} moves imported.\n\nStockfish analysis started.`
      );
    } catch (error) {
      console.error("PGN loading error:", error);
      pgnAnalysisQueueRef.current = [];
      pgnAnalysisActiveRef.current = false;
      pgnAnalysisScoreRef.current = null;

      alert(
        "Invalid PGN file.\n\nPlease check the PGN and try again."
      );
    }
  };

  reader.readAsText(file);
  event.target.value = "";
}

// =====================================================
// UNDO
// =====================================================

function handleUndo() {
  if (!currentNode.parentId) {
    return;
  }

  const parentId = currentNode.parentId;

  // Find the position of the current node
  const parentNode = tree[parentId];

  if (!parentNode) {
    return;
  }

  const childIndex =
    parentNode.children.indexOf(currentNodeId);

  // Collect the whole subtree so Redo can restore it
  const removedNodes = {};

  function collectSubtree(nodeId) {
    const node = tree[nodeId];

    if (!node) {
      return;
    }

    removedNodes[nodeId] = node;

    node.children.forEach((childId) => {
      collectSubtree(childId);
    });
  }

  collectSubtree(currentNodeId);

  // Save removed move for REDO
  setRedoStack((old) => [
    ...old,
    {
      rootId: currentNodeId,
      parentId,
      childIndex,
      nodes: removedNodes,
    },
  ]);

  // Remove current node from the tree
  setTree((oldTree) => {
    const newTree = {
      ...oldTree,
    };

    const newParent = {
      ...newTree[parentId],
      children: [
        ...newTree[parentId].children,
      ],
    };

    newParent.children.splice(
      childIndex,
      1
    );

    newTree[parentId] = newParent;

    // Delete the whole removed subtree
    Object.keys(removedNodes).forEach((id) => {
      delete newTree[id];
    });

    return newTree;
  });

  // Go back to parent position
  setCurrentNodeId(parentId);

  setSelectedSquare(null);
  setPromotion(null);

  pendingMoveRef.current = null;
}


// =====================================================
// REDO
// =====================================================

function handleRedo() {
  if (redoStack.length === 0) {
    return;
  }

  const redoItem =
    redoStack[redoStack.length - 1];

  if (
    !redoItem ||
    !tree[redoItem.parentId]
  ) {
    setRedoStack([]);
    return;
  }

  // Restore the removed nodes
  setTree((oldTree) => {
    const newTree = {
      ...oldTree,
      ...redoItem.nodes,
    };

    const parentNode = {
      ...newTree[redoItem.parentId],
      children: [
        ...newTree[redoItem.parentId]
          .children,
      ],
    };

    // Put the move back in its original position
    parentNode.children.splice(
      redoItem.childIndex,
      0,
      redoItem.rootId
    );

    newTree[redoItem.parentId] =
      parentNode;

    return newTree;
  });

  // Remove this item from redo stack
  setRedoStack((old) =>
    old.slice(0, -1)
  );

  // Go to restored move
  setCurrentNodeId(
    redoItem.rootId
  );

  setSelectedSquare(null);
  setPromotion(null);

  pendingMoveRef.current = null;
}
  // =====================================================
  // MAKE MOVE
  // =====================================================

  function makeMove(
    from,
    to,
    promotionPiece = null
  ) {
    const newGame = new Chess(
      currentNode.fen
    );

    const moveData = {
      from,
      to,
    };

    if (promotionPiece) {
      moveData.promotion =
        promotionPiece;
    }

    try {
      const move =
        newGame.move(moveData);

      if (!move) {
        return;
      }

      // =================================================
      // EXISTING CHILD
      // =================================================

      const existingChild =
        currentNode.children
          .map((id) => tree[id])
          .find(
            (node) =>
              node?.move?.from ===
                from &&
              node?.move?.to === to &&
              (node?.move?.promotion ||
                null) ===
                (promotionPiece ||
                  null)
          );

      if (existingChild) {
        setUndoStack((old) => [
          ...old,
          currentNodeId,
        ]);

        setRedoStack([]);

        setCurrentNodeId(
          existingChild.id
        );

        setSelectedSquare(null);
        setPromotion(null);

        return;
      }

      // =================================================
      // CREATE NEW NODE / VARIATION
      // =================================================

      const moveId =
        `${Date.now()}-${Math.random()
          .toString(36)
          .slice(2)}`;

      const newNode = {
        id: moveId,

        parentId:
          currentNodeId,

        fen: newGame.fen(),

        children: [],

        move: {
          from,
          to,
          promotion:
            promotionPiece || null,

          san: move.san,

          color: game.turn(),

          moveNumber:
            game.moveNumber(),
        },

        evaluationBefore:
          evaluationRef.current,

        evaluationAfter: null,

        loss: null,

        classification: null,

        analyzing: true,
      };

      setTree((oldTree) => ({
        ...oldTree,

        [moveId]: newNode,

        [currentNodeId]: {
          ...oldTree[currentNodeId],

          children: [
            ...oldTree[
              currentNodeId
            ].children,

            moveId,
          ],
        },
      }));

      // Update opening detector
      const openingMoves = [];
      let openingNodeId = currentNodeId;

      while (
        openingNodeId &&
        tree[openingNodeId]
      ) {
        const node = tree[openingNodeId];

        if (node.move?.san) {
          openingMoves.unshift(node.move.san);
        }

        openingNodeId = node.parentId;
      }

      openingMoves.push(move.san);
      updateOpeningFromMoves(openingMoves);

      setUndoStack((old) => [
        ...old,
        currentNodeId,
      ]);

      setRedoStack([]);

      setCurrentNodeId(moveId);

      setSelectedSquare(null);
      setPromotion(null);

      pendingMoveRef.current = {
        nodeId: moveId,

        beforeEvaluation:
          evaluationRef.current,

        color: game.turn(),

        afterFen: newGame.fen(),
      };
    } catch {
      // Illegal move
    }
  }

  // =====================================================
  // BOARD CLICK
  // =====================================================

  function handleSquareClick(
    row,
    col
  ) {
    const clickedSquare =
      squareName(row, col);

    const piece =
      board[row][col];

    if (selectedSquare) {
      const moves = game.moves({
        square: selectedSquare,
        verbose: true,
      });

      const selectedMove =
        moves.find(
          (move) =>
            move.to ===
            clickedSquare
        );

      if (selectedMove) {
        if (
          selectedMove.promotion
        ) {
          setPromotion({
            from: selectedSquare,
            to: clickedSquare,
            color: game.turn(),
          });

          return;
        }

        makeMove(
          selectedSquare,
          clickedSquare
        );

        return;
      }

      if (
        piece &&
        piece.color === game.turn()
      ) {
        setSelectedSquare(
          clickedSquare
        );
      } else {
        setSelectedSquare(null);
      }

      return;
    }

    if (
      piece &&
      piece.color === game.turn()
    ) {
      setSelectedSquare(
        clickedSquare
      );
    }
  }

  // =====================================================
  // PROMOTION
  // =====================================================

  function handlePromotion(piece) {
    if (!promotion) {
      return;
    }

    makeMove(
      promotion.from,
      promotion.to,
      piece
    );
  }

  // =====================================================
  // PROMOTE TO MAIN
  // =====================================================

  function promoteToMain(nodeId) {
    const node = tree[nodeId];

    if (!node?.parentId) {
      return;
    }

    const parent =
      tree[node.parentId];

    const children = [
      ...parent.children,
    ];

    const index =
      children.indexOf(nodeId);

    if (index <= 0) {
      setContextMenu(null);
      return;
    }

    children.splice(index, 1);

    children.unshift(nodeId);

    setTree((oldTree) => ({
      ...oldTree,

      [node.parentId]: {
        ...oldTree[node.parentId],

        children,
      },
    }));

    setContextMenu(null);
  }

  // =====================================================
  // MAKE SUB-VARIATION
  // =====================================================

  function makeSubVariation(nodeId) {
    const node = tree[nodeId];

    if (!node?.parentId) {
      return;
    }

    const parent =
      tree[node.parentId];

    const children = [
      ...parent.children,
    ];

    const index =
      children.indexOf(nodeId);

    if (
      index < 0 ||
      children.length <= 1
    ) {
      setContextMenu(null);
      return;
    }

    children.splice(index, 1);

    children.push(nodeId);

    setTree((oldTree) => ({
      ...oldTree,

      [node.parentId]: {
        ...oldTree[node.parentId],

        children,
      },
    }));

    setContextMenu(null);
  }

  // =====================================================
  // COLLECT SUBTREE
  // =====================================================

  function collectSubtreeIds(
    nodeId,
    result = []
  ) {
    result.push(nodeId);

    const node = tree[nodeId];

    if (!node) {
      return result;
    }

    node.children.forEach(
      (childId) => {
        collectSubtreeIds(
          childId,
          result
        );
      }
    );

    return result;
  }

  // =====================================================
  // DELETE VARIATION
  // =====================================================

  function deleteVariation(nodeId) {
    const node = tree[nodeId];

    if (!node?.parentId) {
      return;
    }

    const parentId =
      node.parentId;

    const removedIds =
      collectSubtreeIds(nodeId);

    const nextTree = {
      ...tree,
    };

    removedIds.forEach((id) => {
      delete nextTree[id];
    });

    nextTree[parentId] = {
      ...nextTree[parentId],

      children:
        nextTree[parentId].children.filter(
          (id) => id !== nodeId
        ),
    };

    setTree(nextTree);

    if (
      removedIds.includes(
        currentNodeId
      )
    ) {
      setCurrentNodeId(parentId);

      setSelectedSquare(null);
      setPromotion(null);
    }

    setUndoStack([]);
    setRedoStack([]);

    setContextMenu(null);

    pendingMoveRef.current = null;
  }

  // =====================================================
  // CONTEXT MENU
  // =====================================================

  function openContextMenu(
    event,
    nodeId
  ) {
    event.preventDefault();
    event.stopPropagation();

    const node = tree[nodeId];

    if (!node?.parentId) {
      return;
    }

    setContextMenu({
      nodeId,
      x: event.clientX,
      y: event.clientY,
    });
  }

  // =====================================================
  // MOVE TREE
  // =====================================================

  function renderMoveTree(
    parentId,
    depth = 0,
    isVariation = false
  ) {
    const parent =
      tree[parentId];

    if (
      !parent ||
      parent.children.length === 0
    ) {
      return null;
    }

    return (
      <div
        className={
          isVariation
            ? "variation-branch"
            : "main-line"
        }
      >
        {parent.children.map(
          (childId, childIndex) => {
            const node =
              tree[childId];

            if (!node) {
              return null;
            }

            const isCurrent =
              node.id ===
              currentNodeId;

            const isMain =
              childIndex === 0;

            return (
              <div
                className={`variation-node ${
                  isMain
                    ? "main-variation"
                    : "sub-variation"
                }`}
                key={node.id}
              >
                {/* Branch symbol for variations */}
                {!isMain && (
                  <span className="variation-branch-symbol">
                    \
                  </span>
                )}

                <button
                  type="button"
                  className={`move-button ${
                    isCurrent
                      ? "current-move"
                      : ""
                  }`}
                  onClick={() =>
                    goToNode(
                      node.id
                    )
                  }
                  onContextMenu={(
                    event
                  ) =>
                    openContextMenu(
                      event,
                      node.id
                    )
                  }
                  title="Right-click for variation options"
                >
                  <span className="move-number">
                    {node.move.color ===
                    "w"
                      ? `${node.move.moveNumber}.`
                      : `${node.move.moveNumber}...`}
                  </span>

                  <span>
                    {node.move.san}
                  </span>

                  {node.analyzing && (
                    <span className="move-analyzing">
                      ...
                    </span>
                  )}

                  {!node.analyzing &&
                    node.classification
                      ?.symbol && (
                      <span
                        className={`move-classification ${node.classification.className}`}
                        title={
                          node.loss !==
                          null
                            ? `${node.classification.label} - Evaluation loss: ${node.loss.toFixed(
                                2
                              )}`
                            : node
                                .classification
                                .label
                        }
                      >
                        {
                          node
                            .classification
                            .symbol
                        }
                      </span>
                    )}
                </button>

                {renderMoveTree(
                  node.id,
                  depth + 1,
                  !isMain ||
                    isVariation
                )}
              </div>
            );
          }
        )}
      </div>
    );
  }

  // =====================================================
  // EVALUATION
  // =====================================================

  const clampedEvaluation =
    Math.max(
      -5,
      Math.min(5, evaluation)
    );

  const whiteHeight =
    50 +
    clampedEvaluation * 10;

  const lastMove =
    getLastMove();

  // =====================================================
  // UI
  // =====================================================

// =====================================================
// OPENING DETECTOR
// =====================================================

function detectOpening(moves) {
  if (!Array.isArray(moves) || moves.length === 0) {
    return {
      name: "Unknown Opening",
      variation: "",
    };
  }

  const sequence = moves.join(" ");

  // ===================================================
  // 1. e4 e5
  // ===================================================

  if (sequence.startsWith("e4 e5 Nf3 Nc6 Bb5")) {
    return {
      name: "Ruy Lopez",
      variation: "",
    };
  }

  if (sequence.startsWith("e4 e5 Nf3 Nc6 Bc4")) {
    return {
      name: "Italian Game",
      variation: "",
    };
  }

  if (sequence.startsWith("e4 e5 Nf3 Nc6 d4")) {
    return {
      name: "Scotch Game",
      variation: "",
    };
  }

  if (sequence.startsWith("e4 e5 f4")) {
    return {
      name: "King's Gambit",
      variation: "",
    };
  }

  if (sequence.startsWith("e4 e5 Nf3 Nc6 Nc3")) {
    return {
      name: "Four Knights Game",
      variation: "",
    };
  }

  if (sequence.startsWith("e4 e5 Nc3")) {
    return {
      name: "Vienna Game",
      variation: "",
    };
  }

  // ===================================================
  // SICILIAN - SPECIFIC VARIATIONS FIRST
  // ===================================================

  if (
    sequence.startsWith(
      "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6"
    )
  ) {
    return {
      name: "Sicilian Defense",
      variation: "Najdorf Variation",
    };
  }

  if (
    sequence.startsWith(
      "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6"
    )
  ) {
    return {
      name: "Sicilian Defense",
      variation: "Dragon Variation",
    };
  }

  if (sequence.startsWith("e4 c5 c3")) {
    return {
      name: "Sicilian Defense",
      variation: "Alapin Variation",
    };
  }

  if (sequence.startsWith("e4 c5")) {
    return {
      name: "Sicilian Defense",
      variation: "",
    };
  }

  // ===================================================
  // OTHER 1.e4 DEFENSES
  // ===================================================

  if (sequence.startsWith("e4 e6")) {
    return {
      name: "French Defense",
      variation: "",
    };
  }

  if (sequence.startsWith("e4 c6")) {
    return {
      name: "Caro-Kann Defense",
      variation: "",
    };
  }

  if (sequence.startsWith("e4 d6")) {
    return {
      name: "Pirc Defense",
      variation: "",
    };
  }

  if (sequence.startsWith("e4 d5")) {
    return {
      name: "Scandinavian Defense",
      variation: "",
    };
  }

  if (sequence.startsWith("e4 Nf6")) {
    return {
      name: "Alekhine Defense",
      variation: "",
    };
  }

  if (sequence.startsWith("e4 g6")) {
    return {
      name: "Modern Defense",
      variation: "",
    };
  }

  // ===================================================
  // 1.d4
  // ===================================================

  // Specific defenses first
  if (
    sequence.startsWith(
      "d4 Nf6 c4 g6 Nc3 d5"
    )
  ) {
    return {
      name: "Grünfeld Defense",
      variation: "",
    };
  }

  if (
    sequence.startsWith(
      "d4 Nf6 c4 e6 Nc3 Bb4"
    )
  ) {
    return {
      name: "Nimzo-Indian Defense",
      variation: "",
    };
  }

  if (
    sequence.startsWith(
      "d4 Nf6 c4 e6 Nf3 b6"
    )
  ) {
    return {
      name: "Queen's Indian Defense",
      variation: "",
    };
  }

  if (
    sequence.startsWith(
      "d4 Nf6 c4 e6 Nf3 Bb4+"
    )
  ) {
    return {
      name: "Bogo-Indian Defense",
      variation: "",
    };
  }

  if (
    sequence.startsWith(
      "d4 Nf6 c4 c5 d5"
    )
  ) {
    return {
      name: "Benoni Defense",
      variation: "",
    };
  }

  if (sequence.startsWith("d4 Nf6 c4 g6")) {
    return {
      name: "King's Indian Defense",
      variation: "",
    };
  }

  if (sequence.startsWith("d4 f5")) {
    return {
      name: "Dutch Defense",
      variation: "",
    };
  }

  if (sequence.startsWith("d4 d5 c4 e6")) {
    return {
      name: "Queen's Gambit",
      variation: "Declined",
    };
  }

  if (sequence.startsWith("d4 d5 c4 dxc4")) {
    return {
      name: "Queen's Gambit",
      variation: "Accepted",
    };
  }

  if (sequence.startsWith("d4 d5 c4 c6")) {
    return {
      name: "Slav Defense",
      variation: "",
    };
  }

  if (sequence.startsWith("d4 d5 c4")) {
    return {
      name: "Queen's Gambit",
      variation: "",
    };
  }

  // ===================================================
  // OTHER OPENINGS
  // ===================================================

  if (sequence.startsWith("c4")) {
    return {
      name: "English Opening",
      variation: "",
    };
  }

  if (sequence.startsWith("Nf3")) {
    return {
      name: "Réti Opening",
      variation: "",
    };
  }

  if (sequence.startsWith("b3")) {
    return {
      name: "Nimzowitsch-Larsen Attack",
      variation: "",
    };
  }

  if (sequence.startsWith("f4")) {
    return {
      name: "Bird Opening",
      variation: "",
    };
  }

  return {
    name: "Unknown Opening",
    variation: "",
  };
}

// =====================================================
// UPDATE OPENING
// =====================================================

function updateOpeningFromMoves(moves) {
  if (!Array.isArray(moves) || moves.length === 0) {
    return;
  }

  const opening = detectOpening(moves);

  if (opening.name === "Unknown Opening") {
    return;
  }

  setOpeningInfo(opening);
}


  return (
    <div className="app">
      <h1>♟ Chess Analyzer</h1>
        <div className="opening-info">
  <div className="opening-name">
    🏰 {openingInfo.name}
  </div>

  {openingInfo.variation && (
    <div className="opening-variation">
      {openingInfo.variation}
    </div>
  )}
</div>
      <div className="game-area">

        {/* ===============================================
            EVALUATION BAR
        =============================================== */}

        <div className="evaluation-container">
          <div className="evaluation-bar">
            <div
              className="evaluation-white"
              style={{
                height:
                  `${whiteHeight}%`,
              }}
            />

            <div className="evaluation-black" />
          </div>

          <div className="evaluation-number">
            {evaluation >= 0
              ? "+"
              : ""}
            {evaluation.toFixed(1)}
          </div>
        </div>

        {/* ===============================================
            BOARD
        =============================================== */}

        <div className="board-section">
          <div className="board-wrapper">
            <div className="board">
            {board.map(
              (row, rowIndex) =>
                row.map(
                  (
                    piece,
                    colIndex
                  ) => {
                    const square =
                      squareName(
                        rowIndex,
                        colIndex
                      );

                    const isDark =
                      (rowIndex +
                        colIndex) %
                        2 ===
                      1;

                    const isSelected =
                      selectedSquare ===
                      square;

                    const isLegal =
                      isLegalMove(
                        square
                      );

                    const isLastMove =
                      lastMove &&
                      (
                        lastMove.from ===
                          square ||
                        lastMove.to ===
                          square
                      );

                    return (
                      <div
                        key={square}
                        className={`square ${
                          isDark
                            ? "dark"
                            : "light"
                        } ${
                          isSelected
                            ? "selected"
                            : ""
                        } ${
                          isLegal
                            ? "legal-move"
                            : ""
                        } ${
                          isLastMove
                            ? "last-move"
                            : ""
                        }`}
                        onClick={() =>
                          handleSquareClick(
                            rowIndex,
                            colIndex
                          )
                        }
                      >
                        {piece && (
                          <span
                            className={
                              piece.color ===
                              "w"
                                ? "white-piece"
                                : "black-piece"
                            }
                          >
                            {
                              pieceSymbols[
                                piece.color
                              ][
                                piece.type
                              ]
                            }
                          </span>
                        )}
                      </div>
                    );
                  }
                )
            )}
            </div>

            </div>

          {/* =============================================
              ICON NAVIGATION
          ============================================= */}

          <div className="notation-controls">

            {/* Previous */}
            <button
              type="button"
              className="icon-button previous-button"
              onClick={
                handlePreviousMove
              }
              disabled={
                !currentNode.parentId
              }
              title="Previous Move"
              aria-label="Previous Move"
            >
              <span aria-hidden="true">
                ‹
              </span>
            </button>

            {/* Undo */}
            <button
              type="button"
              className="icon-button undo-button"
              onClick={
                handleUndo
              }
              disabled={
                !currentNode.parentId
              }
              title="Undo"
              aria-label="Undo"
            >
              <span aria-hidden="true">
                ↶
              </span>
            </button>

            {/* Redo */}
            <button
              type="button"
              className="icon-button redo-button"
              onClick={
                handleRedo
              }
              disabled={
                redoStack.length ===
                0
              }
              title="Redo"
              aria-label="Redo"
            >
              <span aria-hidden="true">
                ↷
              </span>
            </button>

            {/* Next */}
            <button
              type="button"
              className="icon-button next-button"
              onClick={
                handleNextMove
              }
              disabled={
                currentNode.children
                  .length === 0
              }
              title="Next Move"
              aria-label="Next Move"
            >
              <span aria-hidden="true">
                ›
              </span>
            </button>

          </div>

              <div className="pgn-import">
  <label
    htmlFor="pgn-file"
    className="pgn-button"
  >
    ＋ Add PGN
  </label>

  <input
    id="pgn-file"
    type="file"
    accept=".pgn"
    onChange={handlePGNImport}
    className="pgn-file-input"
  />
</div>

<div className="evaluation-graph">
  <h3>Game Evaluation</h3>

  {evaluationGraphData.length > 0 ? (
    <div className="graph-area">
      <svg
  className="evaluation-line"
  viewBox="0 0 100 100"
  preserveAspectRatio="none"
>
  <polyline
    points={evaluationGraphData
      .map((item, index) => {
        const maxMove =
          Math.max(
            1,
            evaluationGraphData.length - 1
          );

        const x =
          (index / maxMove) * 100;

        const clampedEvaluation =
          Math.max(
            -5,
            Math.min(5, item.evaluation)
          );

        const y =
          50 - clampedEvaluation * 10;

        return `${x},${y}`;
      })
      .join(" ")}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    vectorEffect="non-scaling-stroke"
  />
</svg>
    </div>
  ) : (
    <div className="graph-empty">
      No evaluation data yet
    </div>
  )}
</div>

          {/* =============================================
              STATUS
          ============================================= */}

          <p className="status">
            {currentNode.parentId
              ? `Move: ${currentNode.move.moveNumber}${
                  currentNode.move.color ===
                  "b"
                    ? "..."
                    : "."
                } ${
                  currentNode.move.san
                }`
              : "Starting Position"}
          </p>

          <p className="status">
            Turn:{" "}
            {game.turn() === "w"
              ? "White"
              : "Black"}
          </p>

          {game.isCheck() && (
            <p className="check">
              Check!
            </p>
          )}

          {game.isCheckmate() && (
            <p className="check">
              Checkmate!
            </p>
          )}
        </div>

        {/* ===============================================
            MOVE HISTORY / NOTATION
        =============================================== */}

        <div className="move-history">
          <h2>Move History</h2>

          <div className="variation-help">
            Right-click a move for
            variation options.
          </div>

          <div className="moves-tree">
            {tree.root.children
              .length === 0 ? (
              <p className="no-moves">
                No moves yet
              </p>
            ) : (
              renderMoveTree(
                "root"
              )
            )}
          </div>
        </div>
      </div>

      {/* ===============================================
          RIGHT CLICK MENU
      =============================================== */}

      {contextMenu && (
        <div
          className="variation-context-menu"
          style={{
            left:
              `${contextMenu.x}px`,
            top:
              `${contextMenu.y}px`,
          }}
          onClick={(event) =>
            event.stopPropagation()
          }
        >
          {tree[
            contextMenu.nodeId
          ]?.parentId &&
            tree[
              tree[
                contextMenu.nodeId
              ].parentId
            ]?.children.indexOf(
              contextMenu.nodeId
            ) > 0 && (
              <button
                type="button"
                onClick={() =>
                  promoteToMain(
                    contextMenu.nodeId
                  )
                }
              >
                ⭐ Promote to Main Line
              </button>
            )}

          {tree[
            contextMenu.nodeId
          ]?.parentId &&
            tree[
              tree[
                contextMenu.nodeId
              ].parentId
            ]?.children.indexOf(
              contextMenu.nodeId
            ) === 0 &&
            tree[
              tree[
                contextMenu.nodeId
              ].parentId
            ]?.children.length >
              1 && (
              <button
                type="button"
                onClick={() =>
                  makeSubVariation(
                    contextMenu.nodeId
                  )
                }
              >
                ↳ Make Sub-Variation
              </button>
            )}

          <button
            type="button"
            className="delete-variation"
            onClick={() =>
              deleteVariation(
                contextMenu.nodeId
              )
            }
          >
            🗑 Delete Variation
          </button>
        </div>
      )}

      {/* ===============================================
          PROMOTION
      =============================================== */}

      {promotion && (
        <div className="promotion-overlay">
          <div className="promotion-box">
            <h2>
              Choose Promotion
            </h2>

            <div className="promotion-options">
              {[
                [
                  "q",
                  promotion.color ===
                  "w"
                    ? "♕"
                    : "♛",
                  "Queen",
                ],
                [
                  "r",
                  promotion.color ===
                  "w"
                    ? "♖"
                    : "♜",
                  "Rook",
                ],
                [
                  "b",
                  promotion.color ===
                  "w"
                    ? "♗"
                    : "♝",
                  "Bishop",
                ],
                [
                  "n",
                  promotion.color ===
                  "w"
                    ? "♘"
                    : "♞",
                  "Knight",
                ],
              ].map(
                ([
                  piece,
                  symbol,
                  label,
                ]) => (
                  <button
                    type="button"
                    key={piece}
                    onClick={() =>
                      handlePromotion(
                        piece
                      )
                    }
                  >
                    <span className="promotion-piece">
                      {symbol}
                    </span>

                    <span className="promotion-label">
                      {label}
                    </span>
                  </button>
                )
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;