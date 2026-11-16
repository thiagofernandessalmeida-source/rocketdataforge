import React from "react";

interface FlowPythonBodyProps {
  code?: string;
}

export const FlowPythonBody: React.FC<FlowPythonBodyProps> = ({ code = "" }) => {
  const lines = code ? code.split("\n") : ["# Nenhum código definido nesta célula Python"];

  return (
    <div
      style={{
        padding: "10px",
        maxHeight: `${12 * 21 + 20}px`,
        overflowY: "auto",
        overflowX: "auto",
        background: "rgba(0, 0, 0, 0.35)",
        fontFamily: "'Fira Code', 'Cascadia Code', Consolas, monospace",
        fontSize: "0.72rem",
        lineHeight: "21px",
      }}
      role="region"
      aria-label="Código Python da célula (somente leitura)"
    >
      <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "auto" }}>
        <tbody>
          {lines.map((line, idx) => (
            <tr key={idx} style={{ height: "21px" }}>
              <td
                style={{
                  width: "36px",
                  textAlign: "right",
                  paddingRight: "12px",
                  color: "var(--text-muted, #64748b)",
                  userSelect: "none",
                  fontSize: "0.68rem",
                  verticalAlign: "top",
                }}
              >
                {idx + 1}
              </td>
              <td
                style={{
                  color: "var(--text-primary, #e2e8f0)",
                  whiteSpace: "pre",
                  verticalAlign: "top",
                }}
              >
                {line || " "}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
