/**
 * The outage notifications feature, self-contained: drop this folder (plus ../ui) into another
 * app and render <PublishOutageForm/> and <OutageFeed/> with a client from createCommunicationClient().
 */
export { createCommunicationClient, ApiError, isApiError, feedQuery, type CommunicationClient, type StreamHandlers } from './api'
export { PublishOutageForm, type PublishOutageFormProps } from './PublishOutageForm'
export { OutageFeed, type OutageFeedProps } from './OutageFeed'
export { OutageCard, type OutageCardProps } from './OutageCard'
export { useOutageFeed, type OutageFeed as OutageFeedState, type Connection } from './useOutageFeed'
export { applyEvent, effectiveStatus, sortFeed, toFeedItem } from './feed-state'
export { validate, toRequest, emptyDraft, parseServices, localToIso, type OutageDraft, type DraftErrors } from './validation'
export { SEVERITY_TONE, STATUS_TONE, TYPE_HINT, titleCase } from './display'
export * from './types'
