import readline from "node:readline";

const mode = process.env.CODEX_V1_FAKE_MODE ?? "normal";
const turns = [];
let nextTurn = 0;
let waitingServerRequest = null;

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function complete(turn, status = "completed") {
  turn.status = status;
  if (status === "completed") {
    turn.items = [{ id: `item-${turn.id}`, type: "agentMessage", phase: "final_answer", text: `FAKE_OK_${turn.id}` }];
  }
  send({ method: "turn/completed", params: { threadId: "fake-thread", turn } });
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (mode === "invalid" && message.method === "initialize") {
    process.stdout.write("not-json\n");
    return;
  }
  if (mode === "exit" && message.method === "initialize") {
    process.exit(23);
  }
  if (mode === "hang" && message.method === "initialize") {
    return;
  }
  if (message.id === 700 && waitingServerRequest) {
    const turn = waitingServerRequest;
    waitingServerRequest = null;
    complete(turn, message.error ? "failed" : "completed");
    return;
  }
  if (message.method === "initialize") {
    send({ jsonrpc: "2.0", id: message.id, result: {
      userAgent: "codex-cli 0.147.0",
      codexHome: "C:/fake/.codex",
      platformFamily: "windows",
      platformOs: "windows",
    } });
    return;
  }
  if (message.method === "initialized") return;
  if (message.method === "thread/start") {
    send({ method: "thread/started", params: { thread: { id: "fake-thread" } } });
    send({ jsonrpc: "2.0", id: message.id, result: { thread: { id: "fake-thread" } } });
    return;
  }
  if (message.method === "thread/resume") {
    send({ jsonrpc: "2.0", id: message.id, result: { thread: { id: message.params.threadId } } });
    return;
  }
  if (message.method === "thread/read") {
    send({ jsonrpc: "2.0", id: message.id, result: {
      thread: {
        id: message.params.threadId,
        status: { type: "idle" },
        turns,
      },
    } });
    return;
  }
  if (message.method === "turn/start") {
    const turn = { id: `fake-turn-${++nextTurn}`, status: "inProgress", items: [] };
    turns.push(turn);
    const prompt = String(message.params?.input?.[0]?.text ?? "");
    send({ jsonrpc: "2.0", id: message.id, result: { turn } });
    send({ method: "turn/started", params: { threadId: "fake-thread", turn } });
    if (prompt === "LONG") return;
    if (prompt === "SERVER_REQUEST") {
      waitingServerRequest = turn;
      send({ jsonrpc: "2.0", id: 700, method: "item/commandExecution/requestApproval", params: { threadId: "fake-thread", turnId: turn.id } });
      return;
    }
    send({ method: "item/agentMessage/delta", params: { threadId: "fake-thread", turnId: turn.id, itemId: `item-${turn.id}`, delta: "fake" } });
    complete(turn);
    return;
  }
  if (message.method === "turn/interrupt") {
    const turn = turns.find((candidate) => candidate.id === message.params.turnId);
    if (turn) complete(turn, "interrupted");
    send({ jsonrpc: "2.0", id: message.id, result: {} });
  }
});
