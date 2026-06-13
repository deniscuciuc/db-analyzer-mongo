export function printSection(title: string): void {
	console.log(`\n━━━ ${title} ━━━`);
}

export function printRow(label: string, value: string | number): void {
	console.log(`  ${label}: ${value}`);
}

export function printBullet(line: string): void {
	console.log(`  • ${line}`);
}

export function printSubBullet(line: string): void {
	console.log(`    ${line}`);
}

export function printSeparator(): void {
	console.log("");
}
