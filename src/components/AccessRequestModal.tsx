import React, { useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

/**
 * "Request access" and "Request reactivation" -- the two ways somebody outside the app asks
 * to be let in. Both land in access_requests and notify every admin and super admin.
 *
 * The reply is the same whatever the address turns out to be. This form is reachable from
 * the login screen by anyone at all, so telling a stranger "no such account" or "that one is
 * fine, actually" would turn it into a way to find out who works here.
 */

export type AccessRequestKind = 'access' | 'reactivation';

interface Props {
    kind: AccessRequestKind;
    defaultEmail?: string;
    defaultName?: string;
    onClose: () => void;
}

export function AccessRequestModal({ kind, defaultEmail = '', defaultName = '', onClose }: Props) {
    const [name, setName] = useState(defaultName);
    const [email, setEmail] = useState(defaultEmail);
    const [note, setNote] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [sent, setSent] = useState(false);

    const isAccess = kind === 'access';

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        setError(null);

        try {
            const { error: rpcError } = isAccess
                ? await supabase.rpc('request_access', {
                      p_name: name,
                      p_email: email,
                      p_note: note || null,
                  })
                : await supabase.rpc('request_reactivation', {
                      p_email: email,
                      p_note: note || null,
                  });

            if (rpcError) throw new Error(rpcError.message);
            setSent(true);
        } catch (err: any) {
            setError(err.message || 'Could not send your request. Please try again.');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
            <div className="bg-white rounded-xl p-6 max-w-md w-full">
                <div className="flex items-start justify-between mb-4">
                    <div>
                        <h3 className="text-lg font-semibold text-gray-900">
                            {isAccess ? 'Request access' : 'Request reactivation'}
                        </h3>
                        <p className="text-sm text-gray-500 mt-1">
                            {isAccess
                                ? 'Tell the admins who you are and they will set you up.'
                                : 'The admins will be told your account needs turning back on.'}
                        </p>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 shrink-0">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {sent ? (
                    <div className="space-y-4">
                        <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm text-green-800">
                            Thanks — your request is with the admins. They will be in touch by email.
                        </div>
                        <div className="flex justify-end">
                            <button
                                onClick={onClose}
                                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
                            >
                                Done
                            </button>
                        </div>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="space-y-4">
                        {error && (
                            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                                {error}
                            </div>
                        )}

                        {isAccess && (
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                                    Your name <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    required
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    placeholder="Jane Cooper"
                                />
                            </div>
                        )}

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1.5">
                                Work email <span className="text-red-500">*</span>
                            </label>
                            <input
                                type="email"
                                required
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="jane@carestack.com"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1.5">
                                Message <span className="text-gray-400">(optional)</span>
                            </label>
                            <textarea
                                rows={3}
                                maxLength={1000}
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder={
                                    isAccess
                                        ? 'Which team you work with, what you need it for...'
                                        : 'Anything the admins should know.'
                                }
                            />
                        </div>

                        <div className="flex items-center justify-end gap-2 pt-1">
                            <button
                                type="button"
                                onClick={onClose}
                                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={submitting}
                                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                                Send request
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
}
