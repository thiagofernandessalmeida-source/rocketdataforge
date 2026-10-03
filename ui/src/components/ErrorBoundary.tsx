import React, { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
    this.setState({ error, errorInfo });
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: "20px", background: "#f87171", color: "white", fontFamily: "monospace", height: "100vh", overflow: "auto" }}>
          <h2>React App Crashed!</h2>
          <p>Tire um print dessa tela e envie para o assistente:</p>
          <hr />
          <h3 style={{marginTop: "20px"}}>{this.state.error?.toString()}</h3>
          <pre style={{ background: "rgba(0,0,0,0.2)", padding: "10px", marginTop: "10px" }}>
            {this.state.errorInfo?.componentStack}
          </pre>
          <pre style={{ background: "rgba(0,0,0,0.2)", padding: "10px", marginTop: "10px" }}>
            {this.state.error?.stack}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{ padding: "10px 20px", marginTop: "20px", cursor: "pointer" }}
          >
            Recarregar Página
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
