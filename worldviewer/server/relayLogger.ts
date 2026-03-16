type WriteFn = (line: string) => void;

export function createRelayLogger(
  write: WriteFn = (line) => { process.stdout.write(line); },
): Pick<Console, "log" | "warn" | "debug"> {
  function emit(level: "info" | "warn", args: unknown[]): void {
    const entry = {
      ts: new Date().toISOString(),
      level,
      msg: args.map(String).join(" "),
    };
    write(JSON.stringify(entry) + "\n");
  }

  return {
    log: (...args: unknown[]) => emit("info", args),
    warn: (...args: unknown[]) => emit("warn", args),
    debug: () => undefined,
  };
}

let clientIdCounter = 0;

export function nextClientId(): number {
  return ++clientIdCounter;
}
