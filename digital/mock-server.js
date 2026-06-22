const { WebSocketServer } = require("ws");

const port = 8080;
const wss = new WebSocketServer({ port });

console.log(`Mock heading WebSocket on ws://localhost:${port}`);

function generateHeading(tick) {
  const heading = (tick * 0.6) % 360;
  return Number(heading.toFixed(2));
}

wss.on("connection", (socket) => {
  let tick = 0;
  const timer = setInterval(() => {
    tick += 1;
    const heading = generateHeading(tick);
    socket.send(
      JSON.stringify({
        heading,
        rssi: -55 + Math.round(Math.sin(tick * 0.11) * 8),
        source: "mock-server",
        ts: Date.now(),
      }),
    );
  }, 100);

  socket.on("close", () => {
    clearInterval(timer);
  });
});
