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

  if (loss >= 1.0) {
    return {
      label: "Mistake",
      symbol: "?",
      className: "mistake",
    };
  }

  if (loss >= 0.5) {
    return {
      label: "Inaccuracy",
      symbol: "?!",
      className: "inaccuracy",
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

  useEffect(() => {
    gameRef.current = game;
  }, [game]);

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

      if (score === null) {
        return;
      }

      if (
        gameRef.current?.turn() === "b"
      ) {
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

  return (
    <div className="app">
      <h1>♟ Chess Analyzer</h1>

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