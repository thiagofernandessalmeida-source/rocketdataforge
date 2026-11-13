import test, { describe } from "node:test";
import assert from "node:assert/strict";

import {
  buildContextVariablesMap,
  applyContextVarUpdates,
} from "../src/utils/contextVariableUtils.ts";

describe("TAREFA 1: Variáveis de Contexto e Tipagem no jobStore", () => {
  test("buildContextVariablesMap deve retornar mapa de variáveis com conversão estrita de tipos", () => {
    const vars = [
      {
        id: "1",
        key: "MAX_LIMIT",
        type: "number",
        scope: "global",
        isSecret: false,
        values: { dev: "500", hml: "1000", prd: "5000" },
        description: "Limite de linhas",
      },
      {
        id: "2",
        key: "ENABLE_FEATURE",
        type: "boolean",
        scope: "global",
        isSecret: false,
        values: { dev: "true", hml: "false", prd: "false" },
      },
      {
        id: "3",
        key: "SCHEMA_NAME",
        type: "string",
        scope: "global",
        isSecret: false,
        values: { dev: "raw_data", hml: "staging", prd: "prod" },
      },
    ];

    const varsMap = buildContextVariablesMap(vars, "dev");
    assert.equal(typeof varsMap["MAX_LIMIT"], "number");
    assert.equal(varsMap["MAX_LIMIT"], 500);

    assert.equal(typeof varsMap["ENABLE_FEATURE"], "boolean");
    assert.equal(varsMap["ENABLE_FEATURE"], true);

    assert.equal(typeof varsMap["SCHEMA_NAME"], "string");
    assert.equal(varsMap["SCHEMA_NAME"], "raw_data");
  });

  test("applyContextVarUpdates deve atualizar valores no ambiente ativo", () => {
    const vars = [
      {
        id: "1",
        key: "CONTADOR_GLOBAL",
        type: "number",
        scope: "global",
        isSecret: false,
        values: { dev: "1", hml: "1", prd: "1" },
      },
    ];

    const { updatedVars, modified } = applyContextVarUpdates(vars, { CONTADOR_GLOBAL: 42 }, "dev");
    assert.equal(modified, true);
    assert.equal(updatedVars[0].values["dev"], "42");
  });
});
