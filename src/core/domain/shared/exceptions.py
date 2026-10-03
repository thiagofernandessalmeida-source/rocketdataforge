"""Exceções canônicas do domínio RocketDataForge.

Todas as violações de regras de negócio, validações de invariantes
e transições inválidas devem herdar de DomainError.
"""

class DomainError(Exception):
    """Exceção base para todos os erros do núcleo de domínio."""
    def __init__(self, message: str, code: str = "ERR_DOMAIN"):
        super().__init__(message)
        self.message = message
        self.code = code

class DomainValidationError(DomainError):
    """Lançada quando invariantes de entidades ou Value Objects são violadas."""
    def __init__(self, message: str, code: str = "ERR_VALIDATION"):
        super().__init__(message, code)

class SecurityViolationError(DomainError):
    """Lançada quando credenciais ou regras de segredo são violadas."""
    def __init__(self, message: str, code: str = "ERR_SECURITY_VIOLATION"):
        super().__init__(message, code)

class InvalidStateTransitionError(DomainError):
    """Lançada quando ocorre tentativa de transição ilegal em máquinas de estados."""
    def __init__(self, current_state: str, target_state: str, code: str = "ERR_INVALID_TRANSITION"):
        message = f"Transição de estado inválida: de '{current_state}' para '{target_state}'"
        super().__init__(message, code)
        self.current_state = current_state
        self.target_state = target_state

class CyclicDependencyError(DomainError):
    """Lançada quando um ciclo proibido é detectado no grafo direcionado."""
    def __init__(self, message: str = "Ciclo detectado no grafo do pipeline", code: str = "ERR_CYCLIC_DEPENDENCY"):
        super().__init__(message, code)

class PortMismatchError(DomainError):
    """Lançada quando há tentativa de conectar portas incompatíveis."""
    def __init__(self, message: str, code: str = "ERR_PORT_MISMATCH"):
        super().__init__(message, code)
