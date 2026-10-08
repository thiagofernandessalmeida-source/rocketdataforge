"""Avaliador de Políticas ABAC e Simulador Dry-Run.

Implementa matching de ações e recursos com wildcards glob (*, ?) e avaliação
de condições contextuais (ex: limites de tamanho de lote, hosts autorizados,
exigência de documentação).
"""

import fnmatch
from typing import Any, Dict, List, Optional

from src.core.domain.policy.policy_model import (
    EffectEnum,
    EvaluationResult,
    PolicyDocument,
    PolicyStatement,
)


def _match_pattern(pattern: str, value: str) -> bool:
    """Verifica correspondência entre um padrão (com suporte a wildcards) e um valor."""
    if pattern == "*":
        return True
    return fnmatch.fnmatchcase(value, pattern)


def _matches_any(patterns: List[str], value: str) -> bool:
    """Verifica se o valor corresponde a qualquer um dos padrões da lista."""
    return any(_match_pattern(p, value) for p in patterns)


def _evaluate_conditions(conditions: Dict[str, Any], context: Dict[str, Any]) -> tuple[bool, Optional[str]]:
    """Avalia o dicionário de condições contra o contexto fornecido.
    
    Retorna (True, None) se todas as condições forem satisfeitas, ou (False, motivo).
    """
    if not conditions:
        return True, None

    # 1. Condição: max_batch_size
    if "max_batch_size" in conditions:
        max_batch = conditions["max_batch_size"]
        actual_batch = context.get("batch_size")
        if actual_batch is not None and actual_batch > max_batch:
            return False, f"Batch size {actual_batch} excede o limite máximo permitido de {max_batch}."

    # 2. Condição: allowed_hosts
    if "allowed_hosts" in conditions:
        allowed = conditions["allowed_hosts"]
        host = context.get("host")
        if host is not None:
            if isinstance(allowed, list) and not any(_match_pattern(p, host) for p in allowed):
                return False, f"Host '{host}' não está na lista de hosts autorizados: {allowed}."

    # 3. Condição: require_job_description
    if conditions.get("require_job_description"):
        desc = context.get("job_description")
        if not desc or not str(desc).strip():
            return False, "A política exige que a descrição do Job esteja preenchida (require_job_description)."

    # 4. Condição: require_cell_description
    if conditions.get("require_cell_description"):
        desc = context.get("cell_description")
        if not desc or not str(desc).strip():
            return False, "A política exige que a descrição da Célula esteja preenchida (require_cell_description)."

    # 5. Condição: allowed_environments
    if "allowed_environments" in conditions:
        allowed_envs = conditions["allowed_environments"]
        env = context.get("environment")
        if env is not None and env not in allowed_envs:
            return False, f"Ambiente '{env}' não permitido. Ambientes válidos: {allowed_envs}."

    # 6. Condição genérica de igualdade para outras chaves
    for k, v in conditions.items():
        if k in ("max_batch_size", "allowed_hosts", "require_job_description", "require_cell_description", "allowed_environments"):
            continue
        actual = context.get(k)
        if actual is not None and actual != v:
            return False, f"Condição '{k}' esperava '{v}', mas obteve '{actual}'."

    return True, None


class PolicyEvaluator:
    """Motor de avaliação de acesso baseado em políticas ABAC."""

    def __init__(self, policies: Optional[List[PolicyDocument]] = None):
        self.policies = policies or []

    def add_policy(self, policy: PolicyDocument) -> None:
        self.policies.append(policy)

    def evaluate(
        self,
        action: str,
        resource: str,
        context: Optional[Dict[str, Any]] = None,
        principal: Optional[str] = None
    ) -> EvaluationResult:
        """Avalia a solicitação de acesso aplicando a semântica padrão ABAC:
        1. Default Deny: se nenhuma regra Allow casar, nega o acesso.
        2. Explicit Deny: qualquer regra Deny casando com ação, recurso e condição sobrepõe qualquer Allow.
        3. Allow: concede acesso se pelo menos uma regra casar e suas condições forem satisfeitas.
        """
        ctx = context or {}
        evaluated_count = 0
        matching_allows: List[tuple[PolicyStatement, str]] = []

        for policy in self.policies:
            # Se principal foi especificado, apenas avalia políticas vinculadas a este principal (ou wildcard)
            if principal and policy.principal not in (principal, "*"):
                continue

            for stmt in policy.statements:
                evaluated_count += 1
                action_matches = _matches_any(stmt.actions, action)
                resource_matches = _matches_any(stmt.resources, resource)

                if not (action_matches and resource_matches):
                    continue

                cond_ok, cond_fail_reason = _evaluate_conditions(stmt.conditions, ctx)

                # Se a declaração for DENY
                if stmt.effect == EffectEnum.DENY:
                    if cond_ok:
                        sid_info = f"'{stmt.sid}'" if stmt.sid else "sem SID"
                        return EvaluationResult(
                            decision=EffectEnum.DENY,
                            allowed=False,
                            matched_statement_sid=stmt.sid,
                            reason=f"Acesso negado explicitamente pela regra {sid_info}.",
                            evaluated_statements_count=evaluated_count,
                        )
                    # Se as condições para o Deny não forem atingidas, ignora esse Deny

                # Se a declaração for ALLOW
                elif stmt.effect == EffectEnum.ALLOW:
                    if cond_ok:
                        matching_allows.append((stmt, policy.principal))
                    else:
                        # Allow correspondia, mas a condição falhou
                        pass

        # Se houver pelo menos um ALLOW correspondente válido e nenhum DENY explícito
        if matching_allows:
            best_stmt, _ = matching_allows[0]
            sid_info = f"'{best_stmt.sid}'" if best_stmt.sid else "sem SID"
            return EvaluationResult(
                decision=EffectEnum.ALLOW,
                allowed=True,
                matched_statement_sid=best_stmt.sid,
                reason=f"Acesso autorizado pela regra {sid_info}.",
                evaluated_statements_count=evaluated_count,
            )

        # Default Deny
        return EvaluationResult(
            decision=EffectEnum.DENY,
            allowed=False,
            matched_statement_sid=None,
            reason=f"Nenhuma regra Allow encontrada para a ação '{action}' no recurso '{resource}' (Default Deny).",
            evaluated_statements_count=evaluated_count,
        )
