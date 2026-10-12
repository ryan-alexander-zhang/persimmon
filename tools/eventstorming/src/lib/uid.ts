// Ids for nodes, edges and contexts. Opaque and unique is all the DSL asks of them;
// short enough that a grammar finding naming one still reads as a sentence.
export const uid = (): string => crypto.randomUUID().replaceAll("-", "").slice(0, 12);
