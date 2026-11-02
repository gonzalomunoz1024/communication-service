/**
 * The outage notifications feature, self-contained: drop this folder (plus ../ui) into another
 * app and render <PublishOutageForm/> and <OutageFeed/> with a client from createCommunicationClient().
 */
export { createCommunicationClient, DEFAULT_CLIENT_ID, ApiError, isApiError, feedQuery, reconnectDelay, type ClientOptions, type CommunicationClient, type StreamHandlers } from './api'
export { explainError, isUnreachable, UNREACHABLE_MESSAGE } from './errors'
export { PublishOutageForm, type PublishOutageFormProps } from './PublishOutageForm'
export { OutageFeed, type OutageFeedProps } from './OutageFeed'
export { OutageCard, type OutageCardProps } from './OutageCard'
export { TicketTag, type TicketTagProps } from './TicketTag'
export { useOutageFeed, type OutageFeed as OutageFeedState, type Connection } from './useOutageFeed'
export { applyEvent, effectiveStatus, inFeed, reconcile, sortFeed, toFeedItem, UPCOMING_WINDOW_MS } from './feed-state'
export { validate, toRequest, emptyDraft, parseServices, localToIso, normaliseTicket, TICKET_NUMBER_PATTERN, type OutageDraft, type DraftErrors } from './validation'
export { SEVERITY_TONE, STATUS_TONE, TYPE_HINT, ticketSystemLabel, titleCase } from './display'
export * from './types'
