export function parseCsv(text: string): string[][];
export function extractWords(text: string, options?: { maxWords?: number }): { words: string[]; duplicates: number; header: boolean };
export function csvEscape(value: string | number): string;
export function matrixToCsv(words: string[], matrix: number[][], digits?: number): string;
