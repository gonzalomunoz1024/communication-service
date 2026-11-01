package com.atlas.communication.servicenow.application;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * {@code communication.servicenow.*}: the optional ServiceNow integration. With only
 * {@code instance-url} set, tickets get a link into the instance and nothing is called; the
 * credentials and interval for syncing ticket status arrive with the sync phase.
 */
@ConfigurationProperties(prefix = "communication.servicenow")
public record ServiceNowProperties(String instanceUrl) {

    public boolean configured() {
        return instanceUrl != null && !instanceUrl.isBlank();
    }

    /** The instance URL without a trailing slash, or null when no instance is configured. */
    public String baseUrl() {
        if (!configured()) {
            return null;
        }
        String url = instanceUrl.trim();
        while (url.endsWith("/")) {
            url = url.substring(0, url.length() - 1);
        }
        return url;
    }
}
