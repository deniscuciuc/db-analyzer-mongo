#!/usr/bin/env node

// tsc does not preserve a shebang, so the compiled CLI entry gets one here.
const fs = require("node:fs");
const path = require("node:path");

const file = path.join(__dirname, "..", "dist", "src", "cli", "main.js");
const relative = path.relative(path.join(__dirname, ".."), file);

if (!fs.existsSync(file)) {
	console.error(`${relative} not found - run pnpm build first`);
	process.exit(1);
}

const content = fs.readFileSync(file, "utf8");

if (!content.startsWith("#!/usr/bin/env node")) {
	fs.writeFileSync(file, `#!/usr/bin/env node\n${content}`, "utf8");
}

if (process.platform !== "win32") {
	fs.chmodSync(file, 0o755);
}

console.log(`shebang added to ${relative}`);
