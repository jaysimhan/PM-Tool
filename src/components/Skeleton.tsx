import React from 'react';

/**
 * Loading placeholders shaped like the thing that is coming.
 *
 * The pages used to render their real markup against empty arrays while the first fetch was
 * in flight, which reads as a finished page that says you have no work -- the same screen a
 * genuinely empty account gets. Somebody who glances and looks away has been told something
 * false. These stand in until the data lands, so "loading" and "nothing here" stop looking
 * identical.
 *
 * Marked aria-busy and labelled, so a screen reader says "loading" rather than reciting a
 * grid of empty boxes.
 */

export function Skeleton({ className = '' }: { className?: string }) {
    return <div className={`bg-gray-200 rounded animate-pulse ${className}`} />;
}

export function AppSkeleton() {
    return (
        <div role="status" aria-busy="true" aria-label="Loading application" className="min-h-screen bg-gray-50 flex">
            <div className="hidden md:block w-64 bg-white border-r border-gray-200 p-5 space-y-5">
                <Skeleton className="h-8 w-36 mb-8" />
                {Array.from({ length: 7 }, (_, i) => <Skeleton key={i} className="h-9 w-full" />)}
            </div>
            <div className="flex-1 p-8 space-y-6">
                <Header />
                <StatCards count={4} />
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6"><CardList /><BarList /></div>
            </div>
        </div>
    );
}

function Frame({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div role="status" aria-busy="true" aria-label={label} className="space-y-6">
            <span className="sr-only">{label}</span>
            {children}
        </div>
    );
}

function StatCards({ count = 4 }: { count?: number }) {
    return (
        <div className={`grid gap-4 ${count === 5 ? 'grid-cols-2 md:grid-cols-3 lg:grid-cols-5' : 'grid-cols-2 lg:grid-cols-4'}`}>
            {Array.from({ length: count }, (_, i) => (
                <div key={i} className="bg-white rounded-lg border border-gray-200 p-5">
                    <Skeleton className="h-3.5 w-24 mb-3" />
                    <Skeleton className="h-7 w-14" />
                </div>
            ))}
        </div>
    );
}

function BarList({ rows = 5, title = true }: { rows?: number; title?: boolean }) {
    return (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
            {title && <Skeleton className="h-5 w-40 mb-5" />}
            <div className="space-y-4">
                {Array.from({ length: rows }, (_, i) => (
                    <div key={i}>
                        <div className="flex items-center justify-between mb-1.5">
                            <Skeleton className="h-3.5 w-32" />
                            <Skeleton className="h-3.5 w-14" />
                        </div>
                        <Skeleton className="h-2 w-full" />
                    </div>
                ))}
            </div>
        </div>
    );
}

function TableBlock({ rows = 5, cols = 6 }: { rows?: number; cols?: number }) {
    return (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
            <Skeleton className="h-5 w-44 mb-5" />
            <div className="space-y-3">
                <div className="flex gap-4 pb-3 border-b border-gray-200">
                    {Array.from({ length: cols }, (_, i) => <Skeleton key={i} className="h-3 flex-1" />)}
                </div>
                {Array.from({ length: rows }, (_, r) => (
                    <div key={r} className="flex gap-4 py-1">
                        {Array.from({ length: cols }, (_, c) => <Skeleton key={c} className="h-3.5 flex-1" />)}
                    </div>
                ))}
            </div>
        </div>
    );
}

function CardList({ rows = 3, title = true }: { rows?: number; title?: boolean }) {
    return (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
            {title && <Skeleton className="h-5 w-36 mb-5" />}
            <div className="space-y-3">
                {Array.from({ length: rows }, (_, i) => (
                    <div key={i} className="border border-gray-200 rounded-lg p-4">
                        <Skeleton className="h-4 w-3/5 mb-2.5" />
                        <Skeleton className="h-3 w-4/5 mb-3.5" />
                        <div className="flex items-center gap-2">
                            <Skeleton className="h-5 w-20 rounded" />
                            <Skeleton className="h-3 w-16" />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function Header() {
    return (
        <div>
            <Skeleton className="h-7 w-56 mb-2" />
            <Skeleton className="h-4 w-80" />
        </div>
    );
}

type Variant = 'personal' | 'reports' | 'team' | 'review';

export function PageSkeleton({ variant }: { variant: Variant }) {
    if (variant === 'personal') {
        return (
            <Frame label="Loading your tasks">
                <Header />
                {/* The capacity banner is the tallest thing above the fold; leaving it out
                    would make the page jump when the real one arrives. */}
                <div className="bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg p-6">
                    <div className="flex items-center justify-between mb-4">
                        <div>
                            <Skeleton className="h-5 w-40 mb-2 bg-white/30" />
                            <Skeleton className="h-3.5 w-52 bg-white/20" />
                        </div>
                        <Skeleton className="h-9 w-24 bg-white/30" />
                    </div>
                    <Skeleton className="h-3 w-full bg-white/20" />
                </div>
                <StatCards count={4} />
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <CardList rows={3} />
                    <CardList rows={3} />
                </div>
            </Frame>
        );
    }

    if (variant === 'reports') {
        return (
            <Frame label="Loading reports">
                <Header />
                <StatCards count={5} />
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <BarList rows={5} />
                    <BarList rows={5} />
                </div>
                <TableBlock rows={4} cols={6} />
                <TableBlock rows={5} cols={6} />
            </Frame>
        );
    }

    if (variant === 'review') {
        return (
            <Frame label="Loading manager review">
                <Header />
                <StatCards count={3} />
                <CardList rows={3} />
                <CardList rows={2} />
            </Frame>
        );
    }

    // team
    return (
        <Frame label="Loading team dashboard">
            <Header />
            <StatCards count={4} />
            <BarList rows={3} />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <BarList rows={4} />
                <CardList rows={3} />
            </div>
        </Frame>
    );
}
