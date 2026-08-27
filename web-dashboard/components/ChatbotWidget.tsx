'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Send, X } from 'lucide-react';

interface Message {
  id: number;
  text: string;
  sender: 'bot' | 'user';
}

export default function ChatbotWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    { id: 1, text: 'Xin chào! Tôi là trợ lý ảo VMS. Bạn cần hướng dẫn sử dụng phần mềm hay có câu hỏi gì không?', sender: 'bot' }
  ]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isOpen]);

  const handleSend = async () => {
    if (!inputValue.trim()) return;

    const userText = inputValue;
    const userMsg: Message = { id: Date.now(), text: userText, sender: 'user' };
    setMessages((prev) => [...prev, userMsg]);
    setInputValue('');

    const botMsgId = Date.now() + 1;
    const botMsg: Message = { id: botMsgId, text: '', sender: 'bot' };
    setMessages((prev) => [...prev, botMsg]);

    try {
      // In production, you might want to use a relative URL or configured NEXT_PUBLIC_API_URL
      const response = await fetch('http://localhost:8000/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: userText })
      });

      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value, { stream: true });
        setMessages((prev) => prev.map(msg => 
          msg.id === botMsgId ? { ...msg, text: msg.text + chunk } : msg
        ));
      }
    } catch (error) {
      console.error("Chat API Error:", error);
      setMessages((prev) => prev.map(msg => 
        msg.id === botMsgId ? { ...msg, text: "Lỗi kết nối tới server (FastAPI chưa chạy hoặc không tìm thấy Ollama)." } : msg
      ));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSend();
    }
  };

  return (
    <div className="chatbot-widget-container">
      {isOpen && (
        <div className="chatbot-window">
          {/* Header */}
          <div className="chatbot-header">
            <div className="chatbot-header-info">
              <div className="chatbot-avatar">
                <img src="/mascot.png" alt="Bot Avatar" />
              </div>
              <div>
                <div className="chatbot-title">Trợ lý ảo VMS</div>
                <div className="chatbot-status">Sẵn sàng hỗ trợ</div>
              </div>
            </div>
            <button className="chatbot-close-btn" onClick={() => setIsOpen(false)}>
              <X size={20} />
            </button>
          </div>

          {/* Body / Messages */}
          <div className="chatbot-body">
            {messages.map((msg) => (
              <div key={msg.id} className={`chat-bubble ${msg.sender}`}>
                {msg.text}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Footer / Input */}
          <div className="chatbot-footer">
            <input
              type="text"
              className="chatbot-input"
              placeholder="Nhập câu hỏi..."
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <button className="chatbot-send-btn" onClick={handleSend}>
              <Send size={18} />
            </button>
          </div>
        </div>
      )}

      {!isOpen && (
        <button className="chatbot-toggle-btn" onClick={() => setIsOpen(true)}>
          <div className="chatbot-toggle-avatar">
             <img src="/mascot.png" alt="Chat" />
          </div>
        </button>
      )}
    </div>
  );
}
