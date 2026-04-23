import fs from "fs";
import path from "path";
import { config } from "./config";
import type { UnifiedLogEntry, IssueContext } from "./log-types";

const GLOBAL_LOG_FILE = path.join(config.USER_ALONG_DIR, "server.jsonl");

class LogWriter {
  private streams = new Map<string, fs.WriteStream>();

  private getStream(filePath: string): fs.WriteStream {
    let stream = this.streams.get(filePath);
    if (!stream || stream.destroyed) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      stream = fs.createWriteStream(filePath, { flags: "a" });
      this.streams.set(filePath, stream);
    }
    return stream;
  }

  writeGlobal(entry: UnifiedLogEntry): void {
    this.getStream(GLOBAL_LOG_FILE).write(JSON.stringify(entry) + "\n");
  }

  writeSession(ctx: IssueContext, entry: UnifiedLogEntry): void {
    const sessionPath = path.join(
      config.getIssueDir(ctx.owner, ctx.repo, ctx.issueNumber),
      "session.jsonl",
    );
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
    this.getStream(sessionPath).write(JSON.stringify(entry) + "\n");
    this.writeGlobal(entry);
  }

  async flush(): Promise<void> {
    const promises = [...this.streams.values()].map(
      (s) => new Promise<void>((resolve) => s.end(resolve)),
    );
    await Promise.all(promises);
    this.streams.clear();
  }
}

export const logWriter = new LogWriter();
