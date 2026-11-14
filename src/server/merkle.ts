import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import type { Hex } from "viem";
import type { CostLine } from "@/lib/types";

/** Onchain plan commitment: Merkle tree of (index, payee, cap) for every USDC line. */
export function planTree(lines: CostLine[]) {
  const values = lines
    .filter((l) => l.rail !== "subscription")
    .sort((a, b) => a.index - b.index)
    .map((l) => [l.index, l.payee, BigInt(l.approved).toString()] as [number, string, string]);
  // A one-leaf tree has an empty proof, which MerkleProof accepts when leaf == root.
  return StandardMerkleTree.of(values.length ? values : [[0, "0x0000000000000000000000000000000000000000", "0"]], ["uint32", "address", "uint128"]);
}

export function lineProof(lines: CostLine[], line: CostLine) {
  const tree = planTree(lines);
  for (const [i, v] of tree.entries()) if (Number(v[0]) === line.index) return { root: tree.root as Hex, proof: tree.getProof(i) as Hex[] };
  throw new Error(`line ${line.index} not in plan`);
}

export const lineTuple = (line: CostLine) => ({ index: line.index, payee: line.payee, cap: BigInt(line.approved) });
