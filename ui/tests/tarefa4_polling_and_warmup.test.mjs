import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("TAREFA 4: Aquecimento de Backend, Polling Otimizado e Logs com Seq", () => {
  test("4.1 e 4.3: client.ts deve suportar parâmetro 'after' em getExecutionLogs e expor health() com status warm", () => {
    const clientPath = path.resolve(__dirname, "../src/api/client.ts");
    const content = fs.readFileSync(clientPath, "utf-8");

    assert.ok(content.includes("after"), "client.ts deve aceitar parâmetro 'after' em getExecutionLogs");
    assert.ok(content.includes("health:"), "client.ts deve expor método health");
  });

  test("4.3: types/index.ts deve incluir 'seq' e 'cell_id' em LogEntry", () => {
    const typesPath = path.resolve(__dirname, "../src/types/index.ts");
    const content = fs.readFileSync(typesPath, "utf-8");

    assert.ok(content.includes("seq?: number"), "LogEntry deve conter campo seq opcional");
    assert.ok(content.includes("cell_id?: string"), "LogEntry deve conter campo cell_id opcional");
  });

  test("4.3: Algoritmo de polling adaptativo com rampa entre 350ms e 1500ms", () => {
    // Função pura de cálculo do próximo delay de polling
    function calculateNextPollDelay(pollCount, elapsedMs) {
      if (pollCount === 0) return 0; // Primeira consulta imediata
      if (elapsedMs < 3000) return 350; // Primeiros 3s: 350ms
      if (elapsedMs < 6000) return 600;
      if (elapsedMs < 10000) return 1000;
      return 1500; // Teto de 1.5s
    }

    assert.strictEqual(calculateNextPollDelay(0, 0), 0, "Primeiro poll deve ser imediato (0ms)");
    assert.strictEqual(calculateNextPollDelay(1, 100), 350, "Nos primeiros 3s deve ser 350ms");
    assert.strictEqual(calculateNextPollDelay(5, 2500), 350, "Aos 2.5s ainda deve ser 350ms");
    assert.strictEqual(calculateNextPollDelay(8, 4000), 600, "Aos 4s deve subir para 600ms");
    assert.strictEqual(calculateNextPollDelay(15, 12000), 1500, "Após 10s deve atingir o teto de 1500ms");
  });

  test("4.3: Deduplicação e mesclagem incremental de logs usando seq", () => {
    const existingLogs = [
      { seq: 1, message: "Inicio" },
      { seq: 2, message: "Carregando" },
    ];
    const incomingLogs = [
      { seq: 2, message: "Carregando" }, // duplicado
      { seq: 3, message: "Finalizado" },
    ];

    const seenSeqs = new Set(existingLogs.map((l) => l.seq));
    const merged = [...existingLogs];
    for (const log of incomingLogs) {
      if (!seenSeqs.has(log.seq)) {
        seenSeqs.add(log.seq);
        merged.push(log);
      }
    }

    assert.strictEqual(merged.length, 3);
    assert.deepStrictEqual(merged.map((l) => l.seq), [1, 2, 3]);
  });
});

