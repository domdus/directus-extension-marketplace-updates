export async function mapPool<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let next = 0;
	async function worker() {
		while (next < items.length) {
			const index = next++;
			results[index] = await mapper(items[index]!);
		}
	}
	const workers = Array.from({ length: Math.min(limit, Math.max(items.length, 1)) }, () => worker());
	await Promise.all(workers);
	return results;
}
