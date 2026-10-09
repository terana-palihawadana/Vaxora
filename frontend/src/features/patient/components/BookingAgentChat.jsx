import { useState, useEffect, useRef } from 'react';
import agentService from '../services/agentService';

const formatMarkdownText = (text, isUser = false) => {
  if (!text) return '';

  const lines = text.split('\n');
  return lines.map((line, lineIdx) => {
    let trimmed = line.trim();
    if (!trimmed) {
      return <div key={lineIdx} style={{ height: '6px' }} />;
    }

    // Bullet points
    const isBullet = trimmed.startsWith('- ') || (trimmed.startsWith('* ') && !trimmed.startsWith('**'));
    if (isBullet) {
      trimmed = trimmed.substring(2).trim();
    }

    // Numbered lists
    const numMatch = trimmed.match(/^(\d+)\.\s+(.*)/);
    let itemNumber = null;
    if (numMatch) {
      itemNumber = numMatch[1];
      trimmed = numMatch[2];
    }

    // Parse bold (**...**), italics (*...*), code (`...`)
    const parts = [];
    const regex = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(trimmed)) !== null) {
      if (match.index > lastIndex) {
        parts.push(trimmed.substring(lastIndex, match.index));
      }
      const token = match[0];
      if (token.startsWith('**') && token.endsWith('**')) {
        parts.push(
          <strong key={`${lineIdx}-${match.index}`} style={{ fontWeight: 700, color: isUser ? 'var(--color-text-inverse)' : 'var(--color-text-title)' }}>
            {token.slice(2, -2)}
          </strong>
        );
      } else if (token.startsWith('`') && token.endsWith('`')) {
        parts.push(
          <code key={`${lineIdx}-${match.index}`} style={{ background: isUser ? 'rgba(255,255,255,0.2)' : 'var(--color-soft-panel-deep)', padding: '1px 5px', borderRadius: '4px', fontSize: '0.88em', fontFamily: 'monospace' }}>
            {token.slice(1, -1)}
          </code>
        );
      } else if (token.startsWith('*') && token.endsWith('*')) {
        parts.push(
          <em key={`${lineIdx}-${match.index}`}>
            {token.slice(1, -1)}
          </em>
        );
      }
      lastIndex = match.index + token.length;
    }
    if (lastIndex < trimmed.length) {
      parts.push(trimmed.substring(lastIndex));
    }

    if (isBullet) {
      return (
        <div key={lineIdx} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', margin: '3px 0', paddingLeft: '4px' }}>
          <span style={{ color: isUser ? 'var(--color-text-inverse)' : 'var(--color-accent)', fontSize: '9px', marginTop: '6px' }}>●</span>
          <div style={{ flex: 1 }}>{parts}</div>
        </div>
      );
    }

    if (itemNumber) {
      return (
        <div key={lineIdx} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', margin: '3px 0', paddingLeft: '4px' }}>
          <span style={{ fontWeight: 700, color: isUser ? 'var(--color-text-inverse)' : 'var(--color-accent)', fontSize: '13px' }}>{itemNumber}.</span>
          <div style={{ flex: 1 }}>{parts}</div>
        </div>
      );
    }

    return (
      <div key={lineIdx} style={{ margin: '2px 0' }}>
        {parts}
      </div>
    );
  });
};

export default function BookingAgentChat({ onAppointmentCreated, launchPayHere, onClose }) {
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: 'Hello! 👋 I am your **Vaxora AI Booking Concierge** powered by Qwen 14B.\n\nI can help you:\n- 🔍 Find which hospitals have your required vaccine in stock\n- 📅 Discover clinic schedule dates & available 20-minute slots\n- 💉 Reserve your appointment with instant user confirmation\n- 💳 Handle PayHere checkout for private vaccines\n\nHow can I help you today?'
    }
  ]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [agentHealth, setAgentHealth] = useState(null);
  const [checkingHealth, setCheckingHealth] = useState(true);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // Suggested prompt chips
  const suggestedPrompts = [
    "🔍 Which hospitals have Pfizer COVID-19 vaccine?",
    "💉 Book next available slot for Influenza vaccine",
    "📅 Show my booked appointments",
    "🏥 What vaccines are available right now?"
  ];

  // Check agent health on mount
  useEffect(() => {
    let mounted = true;
    agentService.checkHealth().then(status => {
      if (mounted) {
        setAgentHealth(status);
        setCheckingHealth(false);
      }
    });
    return () => { mounted = false; };
  }, []);

  // Auto scroll to bottom of chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const handleSendMessage = async (textToSend = null) => {
    const text = (textToSend || inputMessage).trim();
    if (!text || isLoading) return;

    const newMessages = [...messages, { role: 'user', content: text }];
    setMessages(newMessages);
    setInputMessage('');
    setIsLoading(true);

    try {
      // Send conversation to agent
      const res = await agentService.sendMessage(newMessages);

      const assistantMsg = {
        role: 'assistant',
        content: res.content || 'I processed your request.',
        proposal: res.proposal || null,
        booking: res.booking || null
      };

      setMessages(prev => [...prev, assistantMsg]);

      // If a booking was successfully made through the agent
      if (res.booking && res.booking.success) {
        if (onAppointmentCreated) {
          onAppointmentCreated();
        }

        // If paid and PayHere payload is present, trigger PayHere launcher!
        if (!res.booking.is_free && res.booking.payhere_payload && launchPayHere) {
          const aptId = res.booking.appointment?.id || res.booking.appointment?.Id;
          launchPayHere(res.booking.payhere_payload, aptId);
        }
      }
    } catch (err) {
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: `⚠️ **Agent Communication Error**: ${err.message || 'Could not connect to the Booking Agent service. Please ensure the agent service is reachable.'}`,
          isError: true

        }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleApproveProposal = (proposal) => {
    const prompt = `I approve and confirm booking for ${proposal.vaccine_name} at ${proposal.hospital_name} on ${proposal.appointment_date} at ${proposal.time_slot}. Please proceed with booking.`;
    handleSendMessage(prompt);
  };

  const handleDeclineProposal = () => {
    handleSendMessage("I want to decline this booking proposal. Let's look for other options or dates.");
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div style={{
      background: 'var(--color-surface)',
      borderRadius: '16px',
      border: '1px solid var(--color-border-light)',
      boxShadow: '0 4px 20px -2px rgba(0, 0, 0, 0.05)',
      display: 'flex',
      flexDirection: 'column',
      height: '620px',
      overflow: 'hidden',
      fontFamily: 'inherit'
    }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-accent) 100%)',
        color: 'var(--color-text-inverse)',
        padding: '16px 20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: '1px solid rgba(255, 255, 255, 0.1)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: '38px',
            height: '38px',
            borderRadius: '10px',
            background: 'rgba(255, 255, 255, 0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '20px'
          }}>
            🤖
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>Vaxora AI Booking Concierge</h3>
            <p style={{ margin: '2px 0 0', fontSize: '12px', opacity: 0.9 }}>
              Multi-Step Reasoning Agent • Powered by Qwen 14B
            </p>
          </div>
        </div>

        {/* Right side controls: Health Badge & Close button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* Health Status Badge */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            background: agentHealth?.online ? 'rgba(34, 197, 94, 0.2)' : 'rgba(var(--rgb-error), 0.2)',
            border: `1px solid ${agentHealth?.online ? 'rgba(34, 197, 94, 0.4)' : 'rgba(var(--rgb-error), 0.4)'}`,
            padding: '4px 10px',
            borderRadius: '20px',
            fontSize: '11px',
            fontWeight: 600
          }}>
            <span style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: agentHealth?.online ? 'var(--color-success)' : 'var(--color-error)',
              display: 'inline-block'
            }}></span>
            {checkingHealth ? 'Checking Agent...' : (agentHealth?.online ? 'Agent Online' : 'Agent Offline')}
          </div>


          {onClose && (
            <button
              onClick={onClose}
              title="Close Booking Agent"
              style={{
                background: 'rgba(255, 255, 255, 0.2)',
                border: 'none',
                color: 'var(--color-text-inverse)',
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                fontSize: '16px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background 0.2s'
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.35)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)'}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Messages Container */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '20px',
        background: 'var(--color-bg)',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px'
      }}>
        {messages.map((msg, index) => {
          const isUser = msg.role === 'user';
          return (
            <div
              key={index}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: isUser ? 'flex-end' : 'flex-start',
                gap: '8px'
              }}
            >
              {/* Message Bubble */}
              <div style={{
                maxWidth: '85%',
                padding: '14px 18px',
                borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                background: isUser ? 'var(--color-accent)' : (msg.isError ? 'var(--color-error-bg)' : 'var(--color-surface)'),
                color: isUser ? 'var(--color-text-inverse)' : (msg.isError ? 'var(--color-error)' : 'var(--color-text-title)'),
                border: isUser ? 'none' : (msg.isError ? '1px solid var(--color-error-border)' : '1px solid var(--color-border-light)'),
                boxShadow: isUser ? '0 2px 8px rgba(var(--rgb-info), 0.2)' : '0 2px 6px rgba(0, 0, 0, 0.04)',
                fontSize: '14px',
                lineHeight: '1.6'
              }}>
                {formatMarkdownText(msg.content, isUser)}
              </div>

              {/* Proposal Action Card (User Approval Gate) */}
              {msg.proposal && (
                <div style={{
                  maxWidth: '90%',
                  background: 'var(--color-surface)',
                  border: '2px solid var(--color-accent)',
                  borderRadius: '12px',
                  padding: '16px',
                  boxShadow: '0 4px 14px rgba(var(--rgb-info), 0.1)',
                  marginTop: '4px'
                }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontWeight: 700,
                    color: 'var(--color-accent)',
                    marginBottom: '12px',
                    fontSize: '14px'
                  }}>
                    <span>🛡️</span> Booking Proposal (Approval Required)
                  </div>

                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, 1fr)',
                    gap: '10px',
                    background: 'var(--color-info-bg)',
                    padding: '12px',
                    borderRadius: '8px',
                    fontSize: '13px',
                    color: 'var(--color-accent)',
                    marginBottom: '14px'
                  }}>
                    <div><strong>💉 Vaccine:</strong> {msg.proposal.vaccine_name}</div>
                    <div><strong>🏥 Hospital:</strong> {msg.proposal.hospital_name}</div>
                    <div><strong>📅 Date:</strong> {msg.proposal.appointment_date}</div>
                    <div><strong>⏰ Slot:</strong> {msg.proposal.time_slot}</div>
                    <div style={{ gridColumn: 'span 2' }}>
                      <strong>💰 Price:</strong> {msg.proposal.is_free ? 'Free of Charge' : `LKR ${Number(msg.proposal.price || 0).toLocaleString()}`}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                    <button
                      onClick={handleDeclineProposal}
                      disabled={isLoading}
                      style={{
                        padding: '8px 14px',
                        borderRadius: '6px',
                        border: '1px solid var(--color-border-card)',
                        background: 'var(--color-surface)',
                        color: 'var(--color-text-muted)',
                        fontWeight: 600,
                        fontSize: '12px',
                        cursor: 'pointer'
                      }}
                    >
                      ✕ Decline / Change
                    </button>
                    <button
                      onClick={() => handleApproveProposal(msg.proposal)}
                      disabled={isLoading}
                      style={{
                        padding: '8px 18px',
                        borderRadius: '6px',
                        border: 'none',
                        background: 'var(--color-success)',
                        color: 'var(--color-text-inverse)',
                        fontWeight: 600,
                        fontSize: '12px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        boxShadow: '0 2px 6px rgba(var(--rgb-success), 0.3)'
                      }}
                    >
                      ✓ Approve & Book
                    </button>
                  </div>
                </div>
              )}

              {/* Confirmed Booking Card */}
              {msg.booking && msg.booking.success && (
                <div style={{
                  maxWidth: '90%',
                  background: 'var(--color-success-bg)',
                  border: '1px solid var(--color-success-border)',
                  borderRadius: '12px',
                  padding: '14px 16px',
                  marginTop: '4px'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-success)', fontWeight: 700, fontSize: '13px' }}>
                    <span>🎉</span>
                    {msg.booking.is_free ? 'Appointment Confirmed!' : 'Appointment Reserved (Pending Payment)'}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--color-success)', marginTop: '6px', lineHeight: '1.5' }}>
                    Appointment ID: <code>{msg.booking.appointment?.id || msg.booking.appointment?.Id}</code>
                    <br />
                    Status: <strong style={{ textTransform: 'uppercase' }}>{msg.booking.appointment?.status || 'Confirmed'}</strong>
                  </div>

                  {/* If Paid & PayHere available */}
                  {!msg.booking.is_free && msg.booking.payhere_payload && (
                    <button
                      onClick={() => {
                        const aptId = msg.booking.appointment?.id || msg.booking.appointment?.Id;
                        if (launchPayHere) launchPayHere(msg.booking.payhere_payload, aptId);
                      }}
                      style={{
                        marginTop: '10px',
                        padding: '8px 14px',
                        borderRadius: '6px',
                        background: 'var(--color-accent)',
                        color: 'var(--color-text-inverse)',
                        border: 'none',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      💳 Open PayHere Payment Popup
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Loading Indicator */}
        {isLoading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-text-muted)', fontSize: '13px', fontStyle: 'italic', padding: '8px 0' }}>
            <span style={{ animation: 'spin 1s linear infinite' }}>⏳</span> Agent is thinking & querying hospital schedules...
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Suggested Prompts */}
      {messages.length <= 2 && (
        <div style={{
          padding: '10px 16px',
          background: 'var(--color-surface-subtle)',
          borderTop: '1px solid var(--color-border-light)',
          display: 'flex',
          gap: '8px',
          overflowX: 'auto'
        }}>
          {suggestedPrompts.map((prompt, i) => (
            <button
              key={i}
              onClick={() => handleSendMessage(prompt)}
              disabled={isLoading}
              style={{
                whiteSpace: 'nowrap',
                padding: '6px 12px',
                borderRadius: '20px',
                border: '1px solid var(--color-border-card)',
                background: 'var(--color-surface)',
                color: 'var(--color-text-body)',
                fontSize: '12px',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
            >
              {prompt}
            </button>
          ))}
        </div>
      )}

      {/* Input Field */}
      <div style={{
        padding: '14px 18px',
        background: 'var(--color-surface)',
        borderTop: '1px solid var(--color-border-light)',
        display: 'flex',
        gap: '10px',
        alignItems: 'center'
      }}>
        <textarea
          ref={inputRef}
          value={inputMessage}
          onChange={(e) => setInputMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask anything or request to book a vaccine slot..."
          disabled={isLoading}
          rows={1}
          style={{
            flex: 1,
            resize: 'none',
            padding: '10px 14px',
            borderRadius: '10px',
            border: '1px solid var(--color-border-card)',
            outline: 'none',
            fontSize: '14px',
            fontFamily: 'inherit',
            maxHeight: '80px'
          }}
        />
        <button
          onClick={() => handleSendMessage()}
          disabled={isLoading || !inputMessage.trim()}
          style={{
            padding: '10px 20px',
            borderRadius: '10px',
            background: isLoading || !inputMessage.trim() ? 'var(--color-text-placeholder)' : 'var(--color-accent)',
            color: 'var(--color-text-inverse)',
            border: 'none',
            fontWeight: 600,
            fontSize: '14px',
            cursor: isLoading || !inputMessage.trim() ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            transition: 'background 0.2s'
          }}
        >
          <span>Send</span>
          <span>🚀</span>
        </button>
      </div>
    </div>
  );
}
