# Modelo de Domínio: Iteração Direta e Esquemas Dinâmicos

**Documento:** `specs/002-iteration-inference-fixes/domain-model.md`  
**Versão:** 1.0.0  
**Status:** Aprovado  

---

## 1. Entidades e Value Objects Estendidos

### 1.1 `ParameterToken` (Value Object)
Representa uma referência de coluna de montante a ser interpolada em tempo de execução:
```python
@dataclass(frozen=True)
class ParameterToken:
    node_reference: str   # node_id ou label de origem (ex: "wht453p9" ou "tpostgresinput_1")
    column_name: str      # nome do campo a ser extraído da linha (ex: "person_code")
    raw_token: str        # string literal no texto (ex: "{wht453p9.person_code}")
```

### 1.2 `LogicalScan` (Extensão com Suporte a Iteração)
```python
@dataclass
class LogicalScan(LogicalOperator):
    id: str
    connection_ref: str
    source_path_or_query: str
    format: str = "csv"
    input_ids: List[str] = field(default_factory=list)
    connection_details: Optional[Dict[str, Any]] = None
    raw_config: Dict[str, Any] = field(default_factory=dict)
    
    # Novos atributos de iteração
    is_iterative: bool = False
    parameter_tokens: List[ParameterToken] = field(default_factory=list)
```

### 1.3 `InferredSchema` e `InferredField`
Estrutura canônica de resposta da inferência estrutural:
```python
@dataclass(frozen=True)
class InferredField:
    name: str
    logical_type: LogicalDataType
    physical_type: str
    nullable: bool = True
    description: Optional[str] = None
```

---

## 2. Invariantes de Domínio

1. **INV-ITERATE-01:** Um nó de `Scan` é considerado iterativo se, e somente se, possuir pelo menos uma aresta de entrada conectada de outro nó produtor de registros E contiver pelo menos um token de parâmetro `{node.col}` em sua consulta/caminho ou configuração de extração.
2. **INV-ITERATE-02:** Um ciclo entre nós de iteração é terminantemente proibido e rejeitado pelo `GraphValidator` com o código `ERR_CYCLIC_DEPENDENCY`.
3. **INV-SCHEMA-01:** A inferência de schema deve sempre mapear os tipos físicos específicos do conector (ex: `int4`, `varchar`, `timestamptz`, `Int64`, `Float64`) para o enum `LogicalDataType` do domínio da aplicação.
