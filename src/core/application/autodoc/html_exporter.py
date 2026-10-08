"""Exportador de Documentação Técnica para HTML Autocontido e Auditável.

Gera um documento HTML completo, responsivo e autônomo, com renderização
interativa de diagramas Mermaid.js, suporte a temas e estilos otimizados para impressão em PDF.
"""

import html
import re
from typing import Optional


class HtmlDocExporter:
    """Exporta markdown técnico e diagramas Mermaid em HTML autocontido."""

    @staticmethod
    def export_standalone_html(
        title: str,
        markdown_content: str,
        mermaid_code: Optional[str] = None
    ) -> str:
        """Gera o código HTML completo autocontido."""
        # Se mermaid_code não foi fornecido separadamente, extrai do markdown se existir
        if not mermaid_code:
            mermaid_match = re.search(r"```mermaid\n([\s\S]*?)\n```", markdown_content)
            if mermaid_match:
                mermaid_code = mermaid_match.group(1).strip()

        # Converte markdown básico em elementos HTML estruturados
        html_body = HtmlDocExporter._simple_markdown_to_html(markdown_content)

        return f"""<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{html.escape(title)} - RocketDataForge Auto-Doc</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
    <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
    <script>
        document.addEventListener("DOMContentLoaded", function() {{
            mermaid.initialize({{
                startOnLoad: true,
                theme: 'dark',
                securityLevel: 'loose',
                flowchart: {{
                    useMaxWidth: true,
                    htmlLabels: true,
                    curve: 'basis'
                }}
            }});
        }});
    </script>
    <style>
        :root {{
            --bg-color: #0f172a;
            --card-bg: #1e293b;
            --border-color: #334155;
            --text-main: #f8fafc;
            --text-muted: #94a3b8;
            --accent: #38bdf8;
            --accent-purple: #a855f7;
            --accent-green: #22c55e;
            --code-bg: #090d16;
        }}

        * {{
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }}

        body {{
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            background-color: var(--bg-color);
            color: var(--text-main);
            line-height: 1.6;
            padding: 2.5rem 1.5rem;
        }}

        .container {{
            max-width: 1080px;
            margin: 0 auto;
            background: var(--card-bg);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            padding: 3rem;
            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5);
        }}

        .header-bar {{
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 2px solid var(--border-color);
            padding-bottom: 1.5rem;
            margin-bottom: 2rem;
        }}

        .logo-badge {{
            font-size: 0.85rem;
            font-weight: 700;
            letter-spacing: 0.05em;
            text-transform: uppercase;
            color: var(--accent);
            background: rgba(56, 189, 248, 0.1);
            padding: 0.35rem 0.75rem;
            border-radius: 9999px;
            border: 1px solid rgba(56, 189, 248, 0.3);
        }}

        .print-btn {{
            background: #2563eb;
            color: #fff;
            border: none;
            padding: 0.5rem 1rem;
            border-radius: 6px;
            font-weight: 600;
            cursor: pointer;
            transition: background 0.2s;
        }}
        .print-btn:hover {{
            background: #1d4ed8;
        }}

        h1 {{
            font-size: 2.2rem;
            font-weight: 800;
            color: #ffffff;
            margin-bottom: 0.5rem;
        }}

        h2 {{
            font-size: 1.4rem;
            font-weight: 700;
            color: var(--accent);
            margin-top: 2.5rem;
            margin-bottom: 1rem;
            padding-bottom: 0.5rem;
            border-bottom: 1px solid var(--border-color);
        }}

        h3 {{
            font-size: 1.15rem;
            font-weight: 600;
            color: #e2e8f0;
            margin-top: 1.5rem;
            margin-bottom: 0.75rem;
        }}

        p {{
            margin-bottom: 1rem;
            color: #cbd5e1;
        }}

        blockquote {{
            border-left: 4px solid var(--accent);
            background: rgba(56, 189, 248, 0.05);
            padding: 0.75rem 1.25rem;
            border-radius: 0 8px 8px 0;
            margin-bottom: 1.5rem;
            color: #e2e8f0;
            font-size: 0.95rem;
        }}

        .mermaid-card {{
            background: var(--code-bg);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 1.5rem;
            margin: 1.5rem 0;
            overflow-x: auto;
            text-align: center;
        }}

        table {{
            width: 100%;
            border-collapse: collapse;
            margin: 1.5rem 0;
            background: var(--code-bg);
            border-radius: 8px;
            overflow: hidden;
            border: 1px solid var(--border-color);
        }}

        th, td {{
            padding: 0.75rem 1rem;
            text-align: left;
            border-bottom: 1px solid var(--border-color);
            font-size: 0.92rem;
        }}

        th {{
            background: #1e293b;
            color: #f1f5f9;
            font-weight: 600;
        }}

        tr:last-child td {{
            border-bottom: none;
        }}

        tr:hover td {{
            background: rgba(255, 255, 255, 0.02);
        }}

        code {{
            font-family: 'JetBrains Mono', monospace;
            background: rgba(255, 255, 255, 0.1);
            color: #38bdf8;
            padding: 0.15rem 0.4rem;
            border-radius: 4px;
            font-size: 0.88rem;
        }}

        pre {{
            background: var(--code-bg);
            border: 1px solid var(--border-color);
            border-radius: 6px;
            padding: 1rem;
            overflow-x: auto;
            margin: 1rem 0;
        }}

        pre code {{
            background: none;
            padding: 0;
            color: #e2e8f0;
        }}

        .footer {{
            margin-top: 3rem;
            padding-top: 1.5rem;
            border-top: 1px solid var(--border-color);
            text-align: center;
            font-size: 0.85rem;
            color: var(--text-muted);
        }}

        @media print {{
            body {{
                background: #ffffff;
                color: #000000;
                padding: 0;
            }}
            .container {{
                max-width: 100%;
                border: none;
                box-shadow: none;
                padding: 1rem;
                background: #ffffff;
            }}
            .print-btn {{
                display: none;
            }}
            .header-bar {{
                border-bottom: 2px solid #000;
            }}
            h2 {{
                color: #000;
                border-bottom: 1px solid #ccc;
            }}
            .mermaid-card {{
                background: #f8fafc;
                border: 1px solid #ccc;
            }}
            table, th, td {{
                border: 1px solid #ccc;
                color: #000;
                background: #fff;
            }}
            th {{
                background: #f1f5f9;
            }}
        }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header-bar">
            <div>
                <span class="logo-badge">RocketDataForge | Auto-Doc</span>
            </div>
            <div>
                <button class="print-btn" onclick="window.print()">Salvar como PDF / Imprimir</button>
            </div>
        </div>

        <div class="doc-body">
            {html_body}
        </div>

        <div class="footer">
            RocketDataForge Architecture & Governance • Exportação Técnica Autocontida • {html.escape(title)}
        </div>
    </div>
</body>
</html>
"""

    @staticmethod
    def _simple_markdown_to_html(md: str) -> str:
        """Converte o Markdown gerado em blocos HTML correspondentes."""
        # Se contiver bloco mermaid, encapsula em container de mermaid
        def replace_mermaid(match):
            code = match.group(1).strip()
            return f'<div class="mermaid-card"><div class="mermaid">\n{code}\n</div></div>'

        processed = re.sub(r"```mermaid\n([\s\S]*?)\n```", replace_mermaid, md)

        # Tratar blocos de código SQL e genéricos
        def replace_code_blocks(match):
            lang = match.group(1) or ""
            code_content = match.group(2)
            escaped = html.escape(code_content)
            return f'<pre><code class="language-{lang}">{escaped}</code></pre>'

        processed = re.sub(r"```([a-zA-Z0-9_-]*)\n([\s\S]*?)\n```", replace_code_blocks, processed)

        # Converter títulos
        processed = re.sub(r"^### (.*$)", r"<h3>\1</h3>", processed, flags=re.MULTILINE)
        processed = re.sub(r"^## (.*$)", r"<h2>\1</h2>", processed, flags=re.MULTILINE)
        processed = re.sub(r"^# (.*$)", r"<h1>\1</h1>", processed, flags=re.MULTILINE)

        # Converter blockquotes
        def replace_blockquote(match):
            content = match.group(1).strip()
            return f"<blockquote><p>{content}</p></blockquote>"
        processed = re.sub(r"^> (.*$)", replace_blockquote, processed, flags=re.MULTILINE)

        # Converter tabelas Markdown em HTML
        lines = processed.split("\n")
        in_table = False
        table_html = []
        result_lines = []

        for line in lines:
            line_str = line.strip()
            if line_str.startswith("|") and line_str.endswith("|"):
                cells = [c.strip() for c in line_str.split("|")[1:-1]]
                # Ignorar linha divisória | :--- | :--- |
                if all(re.match(r"^:?-+:?$", c) for c in cells):
                    continue
                if not in_table:
                    in_table = True
                    table_html = ["<table>"]
                    # Primeira linha é cabeçalho
                    th_cells = "".join([f"<th>{c}</th>" for c in cells])
                    table_html.append(f"<thead><tr>{th_cells}</tr></thead><tbody>")
                else:
                    td_cells = "".join([f"<td>{c}</td>" for c in cells])
                    table_html.append(f"<tr>{td_cells}</tr>")
            else:
                if in_table:
                    table_html.append("</tbody></table>")
                    result_lines.append("\n".join(table_html))
                    in_table = False
                    table_html = []
                result_lines.append(line)

        if in_table:
            table_html.append("</tbody></table>")
            result_lines.append("\n".join(table_html))

        final_html = "\n".join(result_lines)

        # Inline code `...`
        final_html = re.sub(r"`([^`]+)`", r"<code>\1</code>", final_html)
        # Bold **...**
        final_html = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", final_html)
        # Italic *...*
        final_html = re.sub(r"\*([^*]+)\*", r"<em>\1</em>", final_html)

        return final_html
