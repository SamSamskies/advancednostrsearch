import handler from "../api/inference.js";

/** Run the same server-only endpoint locally that Vercel serves in production. */
export function inferenceDevPlugin() {
  return {
    name: "inference-api",
    configureServer(server) {
      server.middlewares.use("/api/inference", async (req, res) => {
        res.status = (code) => {
          res.statusCode = code;
          return res;
        };
        res.json = (value) => {
          res.end(JSON.stringify(value));
          return res;
        };
        try {
          const chunks = [];
          let bytes = 0;
          for await (const chunk of req) {
            bytes += chunk.length;
            if (bytes > 100_000) {
              res.setHeader("Content-Type", "application/json");
              res.status(413).json({ error: "payload_too_large" });
              return;
            }
            chunks.push(chunk);
          }
          req.body = Buffer.concat(chunks).toString("utf8") || undefined;
          await handler(req, res);
        } catch {
          if (!res.headersSent) {
            res.setHeader("Content-Type", "application/json");
            res.status(500).json({ error: "provider_error" });
          }
        }
      });
    },
  };
}
