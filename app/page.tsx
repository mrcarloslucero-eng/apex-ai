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
    <div className="flex flex-col h-dvh w-[90%] max-w-[1920px] mx-auto bg-gray-950 text-white border-x border-gray-800">

      {/* Header */}
      <header className="px-6 py-4 border-b border-gray-800 flex items-center gap-3 bg-gray-900">
        <div className="w-10 h-10 bg-red-600 rounded-full flex items-center justify-center font-bold text-base">R</div>
        <div>
          <h1 className="font-bold text-base">The Race Engineer</h1>
          <p className="text-sm text-gray-400">Claude Sonnet 4.6 • Online</p>
        </div>
      </header>

      {/* Chat Messages Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {messages.map((message) => (
          <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[75%] p-4 rounded-2xl text-base leading-relaxed ${
              message.role === 'user'
                ? 'bg-blue-600 text-white rounded-br-md'
                : 'bg-gray-800 text-gray-100 rounded-bl-md'
            }`}>
              {(message.parts ?? []).map((part, i) =>
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
            <div className="bg-gray-800 p-4 rounded-2xl rounded-bl-md text-base text-gray-400 animate-pulse">
              Analyzing telemetry...
            </div>
          </div>
        )}
      </div>

      {/* Input Area */}
      <form onSubmit={handleSubmit} className="px-6 py-4 border-t border-gray-800 bg-gray-900">
        <div className="flex gap-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Box box box..."
            className="flex-1 bg-gray-800 text-white rounded-full px-5 py-3.5 text-base focus:outline-none focus:ring-2 focus:ring-red-500 placeholder-gray-500"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="bg-red-600 hover:bg-red-700 disabled:bg-gray-700 text-white rounded-full px-7 py-3.5 text-base font-medium transition-colors"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}