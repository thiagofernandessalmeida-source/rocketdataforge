import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test("TAREFA 6: PropertyPanel deve conter ajuda contextual e opções para CSV em modo DuckDB", () => {
  const panelPath = path.resolve(__dirname, "../src/features/designer/PropertyPanel.tsx");
  const content = fs.readFileSync(panelPath, "utf-8");

  // Verifica texto de ajuda exigido pela Tarefa 6
  assert.ok(
    content.includes('Use a tabela source_data. Ex.: SELECT \\"minha coluna\\" FROM source_data') ||
    content.includes('Use a tabela source_data. Ex.: SELECT &quot;minha coluna&quot; FROM source_data') ||
    content.includes('Use a tabela source_data'),
    "PropertyPanel deve orientar o uso de 'source_data' com exemplo de aspas"
  );

  // Verifica suporte aos campos delimiter, encoding e has_header
  assert.ok(
    content.includes('handleChange("delimiter"') || content.includes("config.delimiter"),
    "PropertyPanel deve suportar configuração de delimiter"
  );
  assert.ok(
    content.includes('handleChange("encoding"') || content.includes("config.encoding"),
    "PropertyPanel deve suportar configuração de encoding"
  );
  assert.ok(
    content.includes('handleChange("has_header"') || content.includes("config.has_header"),
    "PropertyPanel deve suportar configuração de has_header"
  );
});

