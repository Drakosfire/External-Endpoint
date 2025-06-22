import { memo, useCallback, useEffect } from 'react';
import { useRecoilValue } from 'recoil';
import { useForm } from 'react-hook-form';
import { Spinner } from '@librechat/client';
import { useParams } from 'react-router-dom';
import { Constants } from 'librechat-data-provider';
import type { TMessage } from 'librechat-data-provider';
import type { ChatFormValues } from '~/common';
import { ChatContext, AddedChatContext, useFileMapContext, ChatFormProvider } from '~/Providers';
import { useChatHelpers, useAddedResponse, useSSE } from '~/hooks';
import ConversationStarters from './Input/ConversationStarters';
import { useGetMessagesByConvoId } from '~/data-provider';
import MessagesView from './Messages/MessagesView';
import Presentation from './Presentation';
import { buildTree, cn } from '~/utils';
import ChatForm from './Input/ChatForm';
import Landing from './Landing';
import Header from './Header';
import Footer from './Footer';
import store from '~/store';
import { useQueryClient } from '@tanstack/react-query';
import React from 'react';
import { useAuthContext } from '~/hooks/AuthContext';
import logger from '~/utils/logger';

function LoadingSpinner() {
  return (
    <div className="relative flex-1 overflow-hidden overflow-y-auto">
      <div className="relative flex h-full items-center justify-center">
        <Spinner className="text-text-primary" />
      </div>
    </div>
  );
}

function ChatView({ index = 0 }: { index?: number }) {
  const { conversationId } = useParams();
  const queryClient = useQueryClient();
  const { token } = useAuthContext();
  const rootSubmission = useRecoilValue(store.submissionByIndex(index));
  const addedSubmission = useRecoilValue(store.submissionByIndex(index + 1));
  const centerFormOnLanding = useRecoilValue(store.centerFormOnLanding);

  const fileMap = useFileMapContext();

  const { data: messagesTree = null, isLoading } = useGetMessagesByConvoId(conversationId ?? '', {
    select: useCallback(
      (data: TMessage[]) => {
        const dataTree = buildTree({ messages: data, fileMap });
        return dataTree?.length === 0 ? null : (dataTree ?? null);
      },
      [fileMap],
    ),
    enabled: !!fileMap,
  });

  const chatHelpers = useChatHelpers(index, conversationId);
  const addedChatHelpers = useAddedResponse({ rootIndex: index });

  useSSE(rootSubmission, chatHelpers, false);
  useSSE(addedSubmission, addedChatHelpers, true);

  const methods = useForm<ChatFormValues>({
    defaultValues: { text: '' },
  });

  let content: JSX.Element | null | undefined;
  const isLandingPage =
    (!messagesTree || messagesTree.length === 0) &&
    (conversationId === Constants.NEW_CONVO || !conversationId);
  const isNavigating = (!messagesTree || messagesTree.length === 0) && conversationId != null;

  // Real-time SSE subscription for new messages
  // Invalidate the messages query for the current conversation on newMessage event
  React.useEffect(() => {
    if (!conversationId || !token) {
      logger.debug('[ChatView] Missing conversationId or token, skipping SSE connection');
      return;
    }

    let sse: EventSource | null = null;
    let reconnectTimer: NodeJS.Timeout | null = null;
    let isManualClose = false;

    const connectSSE = () => {
      try {
        // Close existing connection if any
        if (sse) {
          isManualClose = true;
          sse.close();
        }

        logger.debug('[ChatView] Initializing SSE connection with token');
        sse = new EventSource(`/api/messages/stream?token=${token}`);
        isManualClose = false;

        sse.addEventListener('newMessage', (event) => {
          logger.debug('[ChatView] SSE newMessage event received:', event.data);
          try {
            const data = JSON.parse(event.data);
            logger.debug('[ChatView] Parsed newMessage data:', data);

            if (data.conversationId === conversationId) {
              logger.debug('[ChatView] ConversationId matches, invalidating query for conversation:', conversationId);
              queryClient.invalidateQueries(['messages', conversationId]);

              // Also try direct cache update for immediate UI response
              if (data.messages && Array.isArray(data.messages)) {
                logger.debug('[ChatView] Updating React Query cache directly with new messages');
                const currentMessages = queryClient.getQueryData(['messages', conversationId]) || [];
                const updatedMessages = [...(currentMessages as TMessage[]), ...(data.messages as TMessage[])];
                queryClient.setQueryData(['messages', conversationId], updatedMessages);
              }
            } else {
              logger.debug('[ChatView] ConversationId mismatch:', {
                eventConversationId: data.conversationId,
                currentConversationId: conversationId
              });
            }
          } catch (error) {
            logger.error('[ChatView] Error parsing newMessage event data:', error);
          }
        });

        sse.addEventListener('newConversation', (event) => {
          logger.debug('[ChatView] SSE newConversation event received:', event.data);
          try {
            const data = JSON.parse(event.data);
            logger.debug('[ChatView] Parsed newConversation data:', data);

            // Invalidate conversations query to refresh the conversation list
            logger.debug('[ChatView] Invalidating conversations query');
            queryClient.invalidateQueries(['conversations']);

            // If this is the current conversation, also invalidate messages
            if (data.conversation?.conversationId === conversationId) {
              logger.debug('[ChatView] New conversation matches current, invalidating messages for:', conversationId);
              queryClient.invalidateQueries(['messages', conversationId]);
            }
          } catch (error) {
            logger.error('[ChatView] Error parsing newConversation event data:', error);
          }
        });

        sse.addEventListener('error', (error) => {
          logger.error('[ChatView] SSE Error:', error);
          logger.error('[ChatView] SSE Error details:', {
            readyState: sse?.readyState,
            url: sse?.url,
            error: error
          });

          // Don't reconnect immediately if manually closed
          if (!isManualClose && sse?.readyState === EventSource.CLOSED) {
            logger.debug('[ChatView] SSE connection lost, scheduling reconnect in 5 seconds');
            reconnectTimer = setTimeout(() => {
              logger.debug('[ChatView] Attempting SSE reconnection');
              connectSSE();
            }, 5000);
          }
        });

        sse.addEventListener('open', () => {
          logger.debug('[ChatView] SSE connection opened successfully');
          logger.debug('[ChatView] SSE connection details:', {
            readyState: sse?.readyState,
            url: sse?.url
          });
          // Clear any pending reconnect timer
          if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
          }
        });

        // Listen for connection confirmation from server
        sse.addEventListener('connected', (event) => {
          logger.debug('[ChatView] SSE connection confirmed by server:', event.data);
          try {
            const data = JSON.parse(event.data);
            logger.debug('[ChatView] SSE connection confirmed for user:', data.userId);
            console.log('✅ SSE Connection Established:', data);
          } catch (error) {
            logger.error('[ChatView] Error parsing connection confirmation:', error);
          }
        });

        // Handle heartbeat messages (optional - just for debugging)
        sse.addEventListener('heartbeat', (event) => {
          logger.debug('[ChatView] SSE heartbeat received');
          // Heartbeat keeps connection alive, no action needed
        });

        // Add test listener for debugging
        sse.addEventListener('testMessage', (event) => {
          logger.debug('[ChatView] SSE test message received:', event.data);
          try {
            const data = JSON.parse(event.data);
            logger.debug('[ChatView] Parsed test message data:', data);

            // You can add a toast notification or console log to verify this works
            console.log('🔥 SSE Test Message Received:', data);
          } catch (error) {
            logger.error('[ChatView] Error parsing test message data:', error);
          }
        });

      } catch (error) {
        logger.error('[ChatView] Error creating SSE connection:', error);
        // Retry connection in 5 seconds
        reconnectTimer = setTimeout(() => {
          logger.debug('[ChatView] Retrying SSE connection after error');
          connectSSE();
        }, 5000);
      }
    };

    // Initial connection
    connectSSE();

    // Cleanup function
    return () => {
      logger.debug('[ChatView] Cleaning up SSE connection');
      isManualClose = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      if (sse) {
        sse.close();
      }
    };
  }, [conversationId, token, queryClient]);

  // Alternative: Polling fallback for external messages (use if SSE fails)
  React.useEffect(() => {
    if (!conversationId) return;

    // Poll for new messages every 2 seconds as fallback
    const pollInterval = setInterval(async () => {
      try {
        // Check if this conversation has external metadata (indicating SMS/external source)
        const currentMessages = queryClient.getQueryData(['messages', conversationId]) as TMessage[] | undefined;
        if (currentMessages && Array.isArray(currentMessages) && currentMessages.length > 0) {
          const latestMessage = currentMessages[currentMessages.length - 1];
          if ((latestMessage as any)?.metadata?.source === 'sms' || (latestMessage as any)?.metadata?.source === 'external') {
            logger.debug('[ChatView] Polling for external message updates');
            queryClient.invalidateQueries(['messages', conversationId]);
          }
        }
      } catch (error) {
        logger.error('[ChatView] Error in polling fallback:', error);
      }
    }, 2000);

    return () => clearInterval(pollInterval);
  }, [conversationId, queryClient]);

  if (isLoading && conversationId !== Constants.NEW_CONVO) {
    content = <LoadingSpinner />;
  } else if ((isLoading || isNavigating) && !isLandingPage) {
    content = <LoadingSpinner />;
  } else if (!isLandingPage) {
    content = <MessagesView messagesTree={messagesTree} />;
  } else {
    content = <Landing centerFormOnLanding={centerFormOnLanding} />;
  }

  return (
    <ChatFormProvider {...methods}>
      <ChatContext.Provider value={chatHelpers}>
        <AddedChatContext.Provider value={addedChatHelpers}>
          <Presentation>
            <div className="flex h-full w-full flex-col">
              {!isLoading && <Header />}
              <>
                <div
                  className={cn(
                    'flex flex-col',
                    isLandingPage
                      ? 'flex-1 items-center justify-end sm:justify-center'
                      : 'h-full overflow-y-auto',
                  )}
                >
                  {content}
                  <div
                    className={cn(
                      'w-full',
                      isLandingPage && 'max-w-3xl transition-all duration-200 xl:max-w-4xl',
                    )}
                  >
                    <ChatForm index={index} />
                    {isLandingPage ? <ConversationStarters /> : <Footer />}
                  </div>
                </div>
                {isLandingPage && <Footer />}
              </>
            </div>
          </Presentation>
        </AddedChatContext.Provider>
      </ChatContext.Provider>
    </ChatFormProvider>
  );
}

export default memo(ChatView);
