import express from "express";
import expressWs from "express-ws";
import { registerStreamRoute } from "./stream-relay.mjs";

const app = express();
expressWs(app);

registerStreamRoute(app, {
  streamerPath: "./streamer",
  buildInitPayload: async ({ hostId, appId }) => { /* ... */ },
});

app.listen(8080);