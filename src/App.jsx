import { useEffect, useRef, useState } from "react";
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

function App() {
  const [game, setGame] = useState(new Chess());
  const [selectedSquare, setSelectedSquare] = useState(null);
  const [lastMove, setLastMove] = useState(null);
  const [promotion, setPromotion] = useState(null);

  const [moveHistory, setMoveHistory] = useState([]);

  const [history, setHistory] = useState([
    new Chess().fen(),
  ]);

  const [historyIndex, setHistoryIndex] = useState(0);

  const [viewIndex, setViewIndex] = useState(0);

  // Stockfish evaluation
  const [evaluation, setEvaluation] = useState(0);
  const [engineReady, setEngineReady] = useState(false);

  const stockfishRef = useRef(null);
  const gameRef = useRef(game);
  const evaluationRef = useRef(evaluation);
  const pendingMoveRef = useRef(null);

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
    // IMPORTANT:
    // import.meta.env.BASE_URL makes the path work
    // both locally and on GitHub Pages.
    const worker = new Worker(
      `${import.meta.env.BASE_URL}stockfish-19-lite-single.js`
    );

    stockfishRef.current = worker;

    worker.onmessage = (event) => {
      const message = event.data;

      if (typeof message !== "string") {
        return;
      }

      // Engine ready
      if (message === "readyok") {
        setEngineReady(true);
        return;
      }

      // Centipawn score
      const cpMatch = message.match(/score cp (-?\d+)/);

      if (cpMatch) {
        const centipawns = parseInt(cpMatch[1], 10);

        let score = centipawns / 100;

        // Stockfish score is from side-to-move perspective.
        // Convert it to White's perspective.
        if (gameRef.current.turn() === "b") {
          score = -score;
        }

        setEvaluation(score);

        // Move classification
        const pending = pendingMoveRef.current;

        if (
          pending &&
          gameRef.current.fen() === pending.afterFen
        ) {
          const before = pending.beforeEvaluation;
          const movedColor = pending.color;

          let loss;

          if (movedColor === "w") {
            loss = before - score;
          } else {
            loss = score - before;
          }

          loss = Math.max(0, loss);

          const classification = classifyMove(loss);

          setMoveHistory((currentHistory) => {
            if (currentHistory.length === 0) {
              return currentHistory;
            }

            const updated = [...currentHistory];
            const lastIndex = updated.length - 1;

            if (updated[lastIndex].id !== pending.id) {
              return currentHistory;
            }

            updated[lastIndex] = {
              ...updated[lastIndex],
              evaluationAfter: score,
              loss,
              classification,
              analyzing: false,
            };

            return updated;
          });

          pendingMoveRef.current = null;
        }

        return;
      }

      // Mate score
      const mateMatch = message.match(/score mate (-?\d+)/);

      if (mateMatch) {
        const mateIn = parseInt(mateMatch[1], 10);

        let score = mateIn > 0 ? 10 : -10;

        if (gameRef.current.turn() === "b") {
          score = -score;
        }

        setEvaluation(score);

        const pending = pendingMoveRef.current;

        if (
          pending &&
          gameRef.current.fen() === pending.afterFen
        ) {
          const before = pending.beforeEvaluation;
          const movedColor = pending.color;

          let loss;

          if (movedColor === "w") {
            loss = before - score;
          } else {
            loss = score - before;
          }

          loss = Math.max(0, loss);

          const classification = classifyMove(loss);

          setMoveHistory((currentHistory) => {
            if (currentHistory.length === 0) {
              return currentHistory;
            }

            const updated = [...currentHistory];
            const lastIndex = updated.length - 1;

            if (updated[lastIndex].id !== pending.id) {
              return currentHistory;
            }

            updated[lastIndex] = {
              ...updated[lastIndex],
              evaluationAfter: score,
              loss,
              classification,
              analyzing: false,
            };

            return updated;
          });

          pendingMoveRef.current = null;
        }
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

    const worker = stockfishRef.current;

    if (!worker) {
      return;
    }

    worker.postMessage("stop");

    worker.postMessage(
      `position fen ${game.fen()}`
    );

    worker.postMessage("go depth 12");
  }, [game, engineReady]);

  // ========================================
  // BOARD
  // ========================================

  const board = game.board();

  function squareName(row, col) {
    const files = "abcdefgh";
    return `${files[col]}${8 - row}`;
  }

  // ========================================
  // LEGAL MOVES
  // ========================================

  function isLegalMove(square) {
    if (!selectedSquare) {
      return false;
    }

    const moves = game.moves({
      square: selectedSquare,
      verbose: true,
    });

    return moves.some((move) => move.to === square);
  }

  // ========================================
  // SAVE POSITION
  // ========================================

  function savePosition(newGame) {
    const newHistory = history.slice(
      0,
      historyIndex + 1
    );

    newHistory.push(newGame.fen());

    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
    setViewIndex(newHistory.length - 1);
  }

  // ========================================
  // MAKE MOVE
  // ========================================

  function makeMove(
    from,
    to,
    promotionPiece = null
  ) {
    // Do not edit an old position.
    if (viewIndex !== history.length - 1) {
      return;
    }

    const newGame = new Chess(game.fen());

    const moveData = {
      from,
      to,
    };

    if (promotionPiece) {
      moveData.promotion = promotionPiece;
    }

    try {
      const move = newGame.move(moveData);

      if (!move) {
        return;
      }

      const beforeEvaluation =
        evaluationRef.current;

      const moveId =
        Date.now() + Math.random();

      pendingMoveRef.current = {
        id: moveId,
        beforeEvaluation,
        color: game.turn(),
        afterFen: newGame.fen(),
      };

      savePosition(newGame);

      setLastMove({
        from,
        to,
      });

      setMoveHistory((previousHistory) => [
        ...previousHistory,
        {
          id: moveId,
          number: previousHistory.length + 1,
          color: game.turn(),
          notation: move.san,
          evaluationBefore: beforeEvaluation,
          evaluationAfter: null,
          loss: null,
          classification: null,
          analyzing: true,
        },
      ]);

      setGame(newGame);
      setSelectedSquare(null);
      setPromotion(null);
    } catch {
      // Invalid move
    }
  }

  // ========================================
  // BOARD CLICK
  // ========================================

  function handleSquareClick(row, col) {
    // Don't edit old positions.
    if (viewIndex !== history.length - 1) {
      return;
    }

    const clickedSquare = squareName(row, col);
    const piece = board[row][col];

    if (selectedSquare) {
      try {
        const moves = game.moves({
          square: selectedSquare,
          verbose: true,
        });

        const selectedMove = moves.find(
          (move) => move.to === clickedSquare
        );

        if (!selectedMove) {
          throw new Error("Illegal move");
        }

        // Promotion
        if (selectedMove.promotion) {
          setPromotion({
            from: selectedSquare,
            to: clickedSquare,
            color: game.turn(),
          });

          return;
        }

        // Normal move
        makeMove(
          selectedSquare,
          clickedSquare
        );

        return;
      } catch {
        // Illegal move
      }

      // Select another piece
      if (
        piece &&
        piece.color === game.turn()
      ) {
        setSelectedSquare(clickedSquare);
      } else {
        setSelectedSquare(null);
      }

      return;
    }

    // Select piece
    if (
      piece &&
      piece.color === game.turn()
    ) {
      setSelectedSquare(clickedSquare);
    }
  }

  // ========================================
  // PROMOTION
  // ========================================

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

  // ========================================
  // UNDO
  // ========================================

  function handleUndo() {
    if (historyIndex === 0) {
      return;
    }

    pendingMoveRef.current = null;

    const newIndex = historyIndex - 1;

    const previousGame = new Chess(
      history[newIndex]
    );

    setGame(previousGame);
    setHistoryIndex(newIndex);
    setViewIndex(newIndex);
    setSelectedSquare(null);
    setPromotion(null);

    rebuildMoveHistory(newIndex);

    if (newIndex > 0) {
      setLastMoveFromHistory(newIndex);
    } else {
      setLastMove(null);
    }
  }

  // ========================================
  // REDO
  // ========================================

  function handleRedo() {
    if (
      historyIndex >=
      history.length - 1
    ) {
      return;
    }

    pendingMoveRef.current = null;

    const newIndex = historyIndex + 1;

    const nextGame = new Chess(
      history[newIndex]
    );

    setGame(nextGame);
    setHistoryIndex(newIndex);
    setViewIndex(newIndex);
    setSelectedSquare(null);
    setPromotion(null);

    rebuildMoveHistory(newIndex);
    setLastMoveFromHistory(newIndex);
  }

  // ========================================
  // PREVIOUS MOVE
  // ========================================

  function handlePreviousMove() {
    if (viewIndex === 0) {
      return;
    }

    const newIndex = viewIndex - 1;

    const previousGame = new Chess(
      history[newIndex]
    );

    setGame(previousGame);
    setViewIndex(newIndex);
    setSelectedSquare(null);
    setPromotion(null);

    if (newIndex > 0) {
      setLastMoveFromHistory(newIndex);
    } else {
      setLastMove(null);
    }
  }

  // ========================================
  // NEXT MOVE
  // ========================================

  function handleNextMove() {
    if (
      viewIndex >=
      history.length - 1
    ) {
      return;
    }

    const newIndex = viewIndex + 1;

    const nextGame = new Chess(
      history[newIndex]
    );

    setGame(nextGame);
    setViewIndex(newIndex);
    setSelectedSquare(null);
    setPromotion(null);

    setLastMoveFromHistory(newIndex);
  }

  // ========================================
  // REBUILD MOVE HISTORY
  // ========================================

  function rebuildMoveHistory(index) {
    const rebuiltMoves = [];

    for (let i = 1; i <= index; i++) {
      const before = new Chess(
        history[i - 1]
      );

      const after = new Chess(
        history[i]
      );

      const possibleMoves =
        before.moves({
          verbose: true,
        });

      const move = possibleMoves.find(
        (m) => {
          try {
            const test = new Chess(
              before.fen()
            );

            test.move({
              from: m.from,
              to: m.to,
              promotion: m.promotion,
            });

            return (
              test.fen() ===
              after.fen()
            );
          } catch {
            return false;
          }
        }
      );

      if (move) {
        rebuiltMoves.push({
          id: `${i}-${move.san}`,
          number:
            rebuiltMoves.length + 1,
          color: before.turn(),
          notation: move.san,
          evaluationBefore: 0,
          evaluationAfter: null,
          loss: null,
          classification: null,
          analyzing: false,
        });
      }
    }

    setMoveHistory(rebuiltMoves);
  }

  // ========================================
  // FIND LAST MOVE
  // ========================================

  function setLastMoveFromHistory(index) {
    if (index <= 0) {
      setLastMove(null);
      return;
    }

    const before = new Chess(
      history[index - 1]
    );

    const after = new Chess(
      history[index]
    );

    const possibleMoves =
      before.moves({
        verbose: true,
      });

    const move = possibleMoves.find(
      (m) => {
        try {
          const test = new Chess(
            before.fen()
          );

          test.move({
            from: m.from,
            to: m.to,
            promotion: m.promotion,
          });

          return (
            test.fen() ===
            after.fen()
          );
        } catch {
          return false;
        }
      }
    );

    setLastMove(
      move
        ? {
            from: move.from,
            to: move.to,
          }
        : null
    );
  }

  // ========================================
  // EVALUATION BAR
  // ========================================

  const clampedEvaluation =
    Math.max(
      -5,
      Math.min(5, evaluation)
    );

  const whiteHeight =
    50 + clampedEvaluation * 10;

  // ========================================
  // RENDER
  // ========================================

  return (
    <div className="app">

      <h1>♟ Chess Analyzer</h1>

      <div className="game-area">

        {/* Evaluation Bar */}

        <div className="evaluation-container">

          <div className="evaluation-bar">

            <div
              className="evaluation-white"
              style={{
                height: `${whiteHeight}%`,
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

        {/* Board */}

        <div>

          <div className="board">

            {board.map(
              (row, rowIndex) =>
                row.map(
                  (piece, colIndex) => {

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
                        className={`
                          square
                          ${
                            isDark
                              ? "dark"
                              : "light"
                          }
                          ${
                            isSelected
                              ? "selected"
                              : ""
                          }
                          ${
                            isLegal
                              ? "legal-move"
                              : ""
                          }
                          ${
                            isLastMove
                              ? "last-move"
                              : ""
                          }
                        `}
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
              onClick={handleUndo}
              disabled={
                historyIndex === 0
              }
            >
              ↩ Undo
            </button>

            <button
              onClick={handleRedo}
              disabled={
                historyIndex ===
                history.length - 1
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
                viewIndex === 0
              }
            >
              ↑ Previous Move
            </button>

            <button
              onClick={
                handleNextMove
              }
              disabled={
                viewIndex >=
                history.length - 1
              }
            >
              Next Move ↓
            </button>

          </div>

          {/* Position */}

          <p className="status">

            Move {viewIndex} /{" "}
            {history.length - 1}

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

          {moveHistory.length ===
          0 ? (
            <p className="no-moves">
              No moves yet
            </p>
          ) : (
            <div className="moves-list">

              {moveHistory.map(
                (move, index) => (

                  <span
                    key={
                      move.id ||
                      index
                    }
                    className="move"
                  >

                    {move.color ===
                      "w" && (
                      <strong>
                        {Math.ceil(
                          move.number /
                            2
                        )}
                        .
                      </strong>
                    )}

                    {move.color ===
                      "b" && (
                      <span className="black-move-number">
                        {Math.ceil(
                          move.number /
                            2
                        )}
                        ...
                      </span>
                    )}

                    {move.notation}

                    {move.analyzing && (
                      <span className="move-analyzing">
                        ...
                      </span>
                    )}

                    {!move.analyzing &&
                      move.classification &&
                      move.classification
                        .symbol && (
                        <span
                          className={`move-classification ${move.classification.className}`}
                          title={
                            move.loss !==
                            null
                              ? `${move.classification.label} - Evaluation loss: ${move.loss.toFixed(
                                  2
                                )}`
                              : move.classification.label
                          }
                        >
                          {" "}
                          {
                            move
                              .classification
                              .symbol
                          }
                        </span>
                      )}

                  </span>

                )
              )}

            </div>
          )}

        </div>

      </div>

      {/* Promotion Popup */}

      {promotion && (

        <div className="promotion-overlay">

          <div className="promotion-box">

            <h2>
              Choose Promotion
            </h2>

            <div className="promotion-options">

              <button
                onClick={() =>
                  handlePromotion(
                    "q"
                  )
                }
              >
                {promotion.color ===
                "w"
                  ? "♕"
                  : "♛"}

                <span>
                  Queen
                </span>
              </button>

              <button
                onClick={() =>
                  handlePromotion(
                    "r"
                  )
                }
              >
                {promotion.color ===
                "w"
                  ? "♖"
                  : "♜"}

                <span>
                  Rook
                </span>
              </button>

              <button
                onClick={() =>
                  handlePromotion(
                    "b"
                  )
                }
              >
                {promotion.color ===
                "w"
                  ? "♗"
                  : "♝"}

                <span>
                  Bishop
                </span>
              </button>

              <button
                onClick={() =>
                  handlePromotion(
                    "n"
                  )
                }
              >
                {promotion.color ===
                "w"
                  ? "♘"
                  : "♞"}

                <span>
                  Knight
                </span>
              </button>

            </div>

          </div>

        </div>

      )}

    </div>
  );
}

export default App;