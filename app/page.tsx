'use client';

import { useState } from 'react';
import { useChat } from '@ai-sdk/react';

export default function Chat() {
  const { messages, sendMessage, status } = useChat();
  const [input, setInput] = useState('');
  const isLoading = status !== 'ready';

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    sendMessage({ text: input });
    setInput('');
  }

  return (
    <div className="flex flex-col h-dvh max-w-lg mx-auto bg-gray-950 text-white border-x border-gray-800">

      {/* Header */}
      <header className="p-4 border-b border-gray-800 flex items-center gap-3 bg-gray-900">
        <div className="w-8 h-8 bg-red-600 rounded-full flex items-center justify-center font-bold text-sm">R</div>
        <div>
          <h1 className="font-bold text-sm">The Race Engineer</h1>
          <p className="text-xs text-gray-400">Claude Sonnet 4.6 • Online</p>
        </div>
      </header>

      {/* Chat Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message) => (
          <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] p-3 rounded-2xl text-sm leading-relaxed ${
              message.role === 'user'
                ? 'bg-blue-600 text-white rounded-br-md'
                : 'bg-gray-800 text-gray-100 rounded-bl-md'
            }`}>
              {(message.parts ?? [{ type: 'text', text: message.content ?? '' }]).map((part, i) =>
                part.type === 'text'
                  ? part.text.split('**').map((chunk, j) =>
                      j % 2 === 1 ? <strong key={`${i}-${j}`} className="text-white font-semibold">{chunk}</strong> : chunk
                    )
                  : null
              )}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-800 p-3 rounded-2xl rounded-bl-md text-sm text-gray-400 animate-pulse">
              Analyzing telemetry...
            </div>
          </div>
        )}
      </div>

      {/* Input Area */}
      <form onSubmit={handleSubmit} className="p-4 border-t border-gray-800 bg-gray-900">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Box box box..."
            className="flex-1 bg-gray-800 text-white rounded-full px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 placeholder-gray-500"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="bg-red-600 hover:bg-red-700 disabled:bg-gray-700 text-white rounded-full px-5 py-3 text-sm font-medium transition-colors"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}