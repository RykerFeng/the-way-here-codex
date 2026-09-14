process.removeAllListeners("warning");
process.on("warning", (warning) => {
  if (warning.name === "ExperimentalWarning" && warning.message.startsWith("SQLite is an experimental feature")) return;
  process.stderr.write(`${warning.name}: ${warning.message}\n`);
});
