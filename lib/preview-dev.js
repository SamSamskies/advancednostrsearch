import handler from "../api/preview.js";

/** Serve the production preview endpoint with Vite's local middleware. */
export function previewDevPlugin() {
  return {
    name: "preview-api",
    configureServer(server) {
      server.middlewares.use("/api/preview", async (req, res) => {
        res.status = (code) => {
          res.statusCode = code;
          return res;
        };
        res.json = (value) => {
          res.end(JSON.stringify(value));
          return res;
        };
        try {
          await handler(req, res);
        } catch {
          if (!res.headersSent) {
            res.setHeader("Content-Type", "application/json");
            res.status(500).json({ error: "preview_error" });
          }
        }
      });
    },
  };
}
