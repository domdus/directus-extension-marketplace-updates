export function formatNameList(names: string[]): string {
	const clean = names.map((name) => String(name || '').trim()).filter(Boolean);
	if (clean.length === 0) return '';
	if (clean.length === 1) return clean[0]!;
	if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
	return `${clean.slice(0, -1).join(', ')}, and ${clean[clean.length - 1]}`;
}

export function escapeHtml(value: string): string {
	return String(value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}
