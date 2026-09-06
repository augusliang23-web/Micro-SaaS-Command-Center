import React, { Component, ReactNode, ErrorInfo } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  public override render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#F7F6F2] flex items-center justify-center p-6 text-stone-800">
          <div className="max-w-md w-full bg-white border border-stone-300 rounded-xl p-6 shadow-lg space-y-4 font-mono text-center">
            <div className="h-12 w-12 rounded-full bg-amber-50 border border-amber-300 text-amber-700 flex items-center justify-center mx-auto">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <h2 className="text-base font-bold text-stone-900">
              系統渲染遭遇預期外狀態
            </h2>
            <p className="text-xs text-stone-600 font-sans leading-relaxed">
              Prototype 渲染發生錯誤。瀏覽器記憶體中的狀態未被保存，「恢復控制台」會回到 fixture 初始資料，而非您先前的操作結果。
            </p>
            {this.state.error && (
              <div className="bg-stone-50 p-3 rounded text-[11px] text-stone-500 text-left overflow-x-auto border border-stone-200">
                {this.state.error.message}
              </div>
            )}
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                onClick={this.handleReset}
                className="px-4 py-2 text-xs font-semibold bg-stone-900 hover:bg-stone-800 text-stone-50 rounded-md transition-colors cursor-pointer shadow-xs"
              >
                恢復控制台
              </button>
              <button
                onClick={this.handleReload}
                className="px-4 py-2 text-xs font-semibold bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-md border border-stone-300 transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>重新整理頁面</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
