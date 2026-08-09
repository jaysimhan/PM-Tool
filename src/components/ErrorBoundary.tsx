import React from 'react';
import { captureOperationalError } from '../lib/observability';

/**
 * The last thing between a thrown render error and a white page.
 *
 * React unmounts the whole tree when a render throws and nothing catches it, so before this
 * existed any error in any component -- a task with a field the panel did not expect, a
 * malformed date, a null where a list was assumed -- took the entire application down to a
 * blank screen with the reason visible only in a console nobody has open.
 *
 * There is no error reporting service wired up here. When one is added, componentDidCatch is
 * the single place it needs to go.
 */

interface Props {
    children: React.ReactNode;
    fallback?: React.ReactNode;
    /** Names the part of the app this boundary guards, for the console line. */
    label?: string;
}

interface State {
    hasError: boolean;
    error?: Error;
}

export class ErrorBoundary extends React.Component<Props, State> {
    state: State = { hasError: false, error: undefined };

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo) {
        console.error(`Unhandled error in ${this.props.label || 'the application'}:`, error, info.componentStack);
        captureOperationalError('frontend_crash', error, { boundary: this.props.label || 'application' });
    }

    private reset = () => this.setState({ hasError: false, error: undefined });

    render() {
        if (!this.state.hasError) return this.props.children;
        if (this.props.fallback) return this.props.fallback;

        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
                <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-200 max-w-md w-full text-center">
                    <h1 className="text-xl font-bold text-gray-900 mb-2">Something went wrong</h1>
                    <p className="text-sm text-gray-500 mb-1">
                        This page hit an error it could not recover from on its own. Nothing you
                        had saved is affected.
                    </p>
                    {this.state.error?.message && (
                        <p className="text-xs text-gray-400 font-mono break-words mb-5 mt-3">
                            {this.state.error.message}
                        </p>
                    )}
                    <div className="flex items-center justify-center gap-3">
                        {/* Try again first: a transient failure (a request that lost the
                            network) does not deserve a full reload and the loss of where the
                            reader was. */}
                        <button
                            onClick={this.reset}
                            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                        >
                            Try again
                        </button>
                        <button
                            onClick={() => window.location.reload()}
                            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
                        >
                            Reload the page
                        </button>
                    </div>
                </div>
            </div>
        );
    }
}

export default ErrorBoundary;
