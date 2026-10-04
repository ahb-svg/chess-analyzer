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
  // ========================================
  // VARIATION TREE
  // ========================================

  const [tree, setTree] = useState(() => ({
    root: createRoot(),
  }));

  const [currentNodeId, setCurrentNodeId] =
    useState("root");

  // ========================================
  // BOARD UI
  // ========================================

  const [selectedSquare, setSelectedSquare] =
    useState(null);

  const [promotion, setPromotion] = useState(null);

  // ========================================
  // STOCKFISH
  // ========================================

  const [evaluation, setEvaluation] = useState(0);
  const [engineReady, setEngineReady] =
    useState(false);

  const stockfishRef = useRef(null);
  const gameRef = useRef(null);
  const evaluationRef = useRef(0);
  const pendingMoveRef = useRef(null);

  // ========================================
  // UNDO / REDO
  // ========================================

  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);

  // ========================================
  // RIGHT CLICK MENU
  // ========================================

  const [contextMenu, setContextMenu] =
    useState(null);

  // ========================================
  // CURRENT POSITION
  // ========================================

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

  // ========================================
  // STOCKFISH
  // ========================================

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

      // ----------------------------
      // ENGINE READY
      // ----------------------------

      if (message === "readyok") {
        setEngineReady(true);
        return;
      }

      // ----------------------------
      // CENTIPAWN SCORE
      // ----------------------------

      let score = null;

      const cpMatch = message.match(
        /score cp (-?\d+)/
      );

      if (cpMatch) {
        score =
          parseInt(cpMatch[1], 10) / 100;
      } else {
        // ----------------------------
        // MATE SCORE
        // ----------------------------

        const mateMatch = message.match(
          /score mate (-?\d+)/
        );

        if (mateMatch) {
          const mateIn = parseInt(
            mateMatch[1],
            10
          );

          score =
            mateIn > 0
              ? 10
              : -10;
        }
      }

      if (score === null) {
        return;
      }

      // Stockfish gives score from
      // side-to-move perspective.
      // Convert to White perspective.

      if (
        gameRef.current?.turn() === "b"
      ) {
        score = -score;
      }

      setEvaluation(score);

      // ----------------------------
      // MOVE CLASSIFICATION
      // ----------------------------

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

  // ========================================
  // ANALYZE CURRENT POSITION
  // ========================================

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

    worker.postMessage(
      "go depth 12"
    );
  }, [
    currentNodeId,
    currentNode.fen,
    engineReady,
  ]);

  // ========================================
  // CLOSE CONTEXT MENU
  // ========================================

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

  // ========================================
  // BOARD HELPERS
  // ========================================

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

  // ========================================
  // LAST MOVE
  // ========================================

  function getLastMove() {
    if (!currentNode.move) {
      return null;
    }

    return {
      from: currentNode.move.from,
      to: currentNode.move.to,
    };
  }

  // ========================================
  // GO TO NODE
  // ========================================

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

  // ========================================
  // PREVIOUS MOVE
  // ========================================

  function handlePreviousMove() {
    if (!currentNode.parentId) {
      return;
    }

    goToNode(currentNode.parentId);
  }

  // ========================================
  // NEXT MOVE
  // ========================================

  function handleNextMove() {
    if (
      currentNode.children.length === 0
    ) {
      return;
    }

    // First child is always
    // the MAIN variation.

    goToNode(
      currentNode.children[0]
    );
  }

  // ========================================
  // UNDO
  // ========================================

  function handleUndo() {
    if (!currentNode.parentId) {
      return;
    }

    const parentId =
      currentNode.parentId;

    setRedoStack((old) => [
      ...old,
      currentNodeId,
    ]);

    setCurrentNodeId(parentId);

    setSelectedSquare(null);

    setPromotion(null);

    pendingMoveRef.current = null;
  }

  // ========================================
  // REDO
  // ========================================

  function handleRedo() {
    if (redoStack.length === 0) {
      return;
    }

    const nextId =
      redoStack[
        redoStack.length - 1
      ];

    if (!tree[nextId]) {
      setRedoStack([]);

      return;
    }

    setRedoStack((old) =>
      old.slice(0, -1)
    );

    setUndoStack((old) => [
      ...old,
      currentNodeId,
    ]);

    setCurrentNodeId(nextId);

    setSelectedSquare(null);

    setPromotion(null);

    pendingMoveRef.current = null;
  }

  // ========================================
  // MAKE MOVE
  // ========================================

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

      // --------------------------------
      // CHECK IF THIS MOVE ALREADY EXISTS
      // --------------------------------

      const existingChild =
        currentNode.children
          .map(
            (id) => tree[id]
          )
          .find(
            (node) =>
              node?.move?.from ===
                from &&
              node?.move?.to ===
                to &&
              (node?.move?.promotion ||
                null) ===
                (promotionPiece ||
                  null)
          );

      // --------------------------------
      // EXISTING VARIATION
      // --------------------------------

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

      // --------------------------------
      // CREATE NEW VARIATION
      // --------------------------------

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
            promotionPiece ||
            null,

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
          ...oldTree[
            currentNodeId
          ],

          children: [
            ...oldTree[
              currentNodeId
            ].children,

            moveId,
          ],
        },
      }));

      // Current position becomes
      // parent of the new move.

      setUndoStack((old) => [
        ...old,
        currentNodeId,
      ]);

      // A new branch means
      // old redo is no longer valid.

      setRedoStack([]);

      setCurrentNodeId(moveId);

      setSelectedSquare(null);

      setPromotion(null);

      // Stockfish will classify
      // this exact move.

      pendingMoveRef.current = {
        nodeId: moveId,

        beforeEvaluation:
          evaluationRef.current,

        color: game.turn(),

        afterFen:
          newGame.fen(),
      };
    } catch {
      // Illegal move.
    }
  }

  // ========================================
  // BOARD CLICK
  // ========================================

  function handleSquareClick(
    row,
    col
  ) {
    const clickedSquare =
      squareName(row, col);

    const piece =
      board[row][col];

    if (selectedSquare) {
      const moves =
        game.moves({
          square:
            selectedSquare,

          verbose: true,
        });

      const selectedMove =
        moves.find(
          (move) =>
            move.to ===
            clickedSquare
        );

      if (selectedMove) {
        // Promotion

        if (
          selectedMove.promotion
        ) {
          setPromotion({
            from:
              selectedSquare,

            to:
              clickedSquare,

            color:
              game.turn(),
          });

          return;
        }

        // Normal move

        makeMove(
          selectedSquare,
          clickedSquare
        );

        return;
      }

      // Select another piece

      if (
        piece &&
        piece.color ===
          game.turn()
      ) {
        setSelectedSquare(
          clickedSquare
        );
      } else {
        setSelectedSquare(null);
      }

      return;
    }

    // Select piece

    if (
      piece &&
      piece.color ===
        game.turn()
    ) {
      setSelectedSquare(
        clickedSquare
      );
    }
  }

  // ========================================
  // PROMOTION
  // ========================================

  function handlePromotion(
    piece
  ) {
    if (!promotion) {
      return;
    }

    makeMove(
      promotion.from,
      promotion.to,
      piece
    );
  }

  // ========================================
  // PROMOTE VARIATION TO MAIN LINE
  // ========================================

  function promoteToMain(
    nodeId
  ) {
    const node =
      tree[nodeId];

    if (!node?.parentId) {
      return;
    }

    const parent =
      tree[node.parentId];

    const children = [
      ...parent.children,
    ];

    const index =
      children.indexOf(
        nodeId
      );

    if (index <= 0) {
      setContextMenu(null);

      return;
    }

    // Remove it

    children.splice(
      index,
      1
    );

    // Put it first

    children.unshift(
      nodeId
    );

    setTree((oldTree) => ({
      ...oldTree,

      [node.parentId]: {
        ...oldTree[
          node.parentId
        ],

        children,
      },
    }));

    setContextMenu(null);
  }

  // ========================================
  // MAKE SUB-VARIATION
  // ========================================

  function makeSubVariation(
    nodeId
  ) {
    const node =
      tree[nodeId];

    if (!node?.parentId) {
      return;
    }

    const parent =
      tree[node.parentId];

    const children = [
      ...parent.children,
    ];

    const index =
      children.indexOf(
        nodeId
      );

    if (
      index < 0 ||
      children.length <= 1
    ) {
      setContextMenu(null);

      return;
    }

    // Remove from current position

    children.splice(
      index,
      1
    );

    // Put at end

    children.push(nodeId);

    setTree((oldTree) => ({
      ...oldTree,

      [node.parentId]: {
        ...oldTree[
          node.parentId
        ],

        children,
      },
    }));

    setContextMenu(null);
  }

  // ========================================
  // COLLECT SUBTREE
  // ========================================

  function collectSubtreeIds(
    nodeId,
    result = []
  ) {
    result.push(nodeId);

    const node =
      tree[nodeId];

    if (!node) {
      return result;
    }

    node.children.forEach(
      (childId) =>
        collectSubtreeIds(
          childId,
          result
        )
    );

    return result;
  }

  // ========================================
  // DELETE VARIATION
  // ========================================

  function deleteVariation(
    nodeId
  ) {
    const node =
      tree[nodeId];

    if (!node?.parentId) {
      return;
    }

    const parentId =
      node.parentId;

    const parent =
      tree[parentId];

    const removedIds =
      collectSubtreeIds(
        nodeId
      );

    const nextTree = {
      ...tree,
    };

    removedIds.forEach(
      (id) => {
        delete nextTree[id];
      }
    );

    nextTree[parentId] = {
      ...nextTree[parentId],

      children:
        nextTree[
          parentId
        ].children.filter(
          (id) =>
            id !== nodeId
        ),
    };

    setTree(nextTree);

    // If current position was
    // inside deleted branch,
    // return to parent.

    if (
      removedIds.includes(
        currentNodeId
      )
    ) {
      setCurrentNodeId(
        parentId
      );

      setSelectedSquare(null);

      setPromotion(null);
    }

    setUndoStack([]);

    setRedoStack([]);

    setContextMenu(null);

    pendingMoveRef.current =
      null;
  }

  // ========================================
  // RIGHT CLICK
  // ========================================

  function openContextMenu(
    event,
    nodeId
  ) {
    event.preventDefault();

    event.stopPropagation();

    const node =
      tree[nodeId];

    if (!node?.parentId) {
      return;
    }

    setContextMenu({
      nodeId,

      x: event.clientX,

      y: event.clientY,
    });
  }

  // ========================================
  // MOVE TREE RENDERING
  // ========================================

  function renderMoveTree(
    parentId,
    depth = 0
  ) {
    const parent =
      tree[parentId];

    if (
      !parent ||
      parent.children.length ===
        0
    ) {
      return null;
    }

    return parent.children.map(
      (
        childId,
        childIndex
      ) => {
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
            style={{
              marginLeft:
                `${depth * 16}px`,
            }}
            key={node.id}
          >
            <button
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
                        : node.classification.label
                    }
                  >
                    {
                      node
                        .classification
                        .symbol
                    }
                  </span>
                )}

              {!isMain && (
                <span className="variation-label">
                  variation
                </span>
              )}
            </button>

            {renderMoveTree(
              node.id,
              depth + 1
            )}
          </div>
        );
      }
    );
  }

  // ========================================
  // EVALUATION BAR
  // ========================================

  const clampedEvaluation =
    Math.max(
      -5,
      Math.min(
        5,
        evaluation
      )
    );

  const whiteHeight =
    50 +
    clampedEvaluation * 10;

  const lastMove =
    getLastMove();

  // ========================================
  // RENDER
  // ========================================

  return (
    <div className="app">
      <h1>
        ♟ Chess Analyzer
      </h1>

      <div className="game-area">

        {/* Evaluation Bar */}

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
            {evaluation.toFixed(
              1
            )}
          </div>
        </div>

        {/* Board */}

        <div>
          <div className="board">
            {board.map(
              (
                row,
                rowIndex
              ) =>
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
                      (lastMove.from ===
                        square ||
                        lastMove.to ===
                          square);

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

          {/* Undo / Redo */}

          <div className="controls">
            <button
              onClick={
                handleUndo
              }
              disabled={
                !currentNode.parentId
              }
            >
              ↩ Undo
            </button>

            <button
              onClick={
                handleRedo
              }
              disabled={
                redoStack.length ===
                0
              }
            >
              Redo ↪
            </button>
          </div>

          {/* Previous / Next */}

          <div className="controls">
            <button
              onClick={
                handlePreviousMove
              }
              disabled={
                !currentNode.parentId
              }
            >
              ↑ Previous Move
            </button>

            <button
              onClick={
                handleNextMove
              }
              disabled={
                currentNode.children
                  .length === 0
              }
            >
              Next Move ↓
            </button>
          </div>

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

        {/* Move History */}

        <div className="move-history">
          <h2>
            Move History
          </h2>

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

      {/* Context Menu */}

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
                contextMenu
                  .nodeId
              ].parentId
            ]?.children.indexOf(
              contextMenu.nodeId
            ) > 0 && (
              <button
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
                contextMenu
                  .nodeId
              ].parentId
            ]?.children.indexOf(
              contextMenu.nodeId
            ) === 0 &&
            tree[
              tree[
                contextMenu
                  .nodeId
              ].parentId
            ]?.children.length >
              1 && (
              <button
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

      {/* Promotion Popup */}

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
                    key={piece}
                    onClick={() =>
                      handlePromotion(
                        piece
                      )
                    }
                  >
                    {symbol}

                    <span>
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