package com.atlas.communication;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.junit.jupiter.api.Test;

/**
 * The README's request examples are copied as they stand, so what they send is what a publisher
 * learns to send. A notice's title and body are plain text: the feed and the UI show them as
 * written, so Markdown in an example ends up on a customer-facing card as asterisks.
 */
class ReadmeExamplesTest {

    /** A JSON "title" or "body" string as the examples write it, escapes included. */
    private static final Pattern TEXT_FIELD = Pattern.compile("\"(title|body)\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"");
    /** Emphasis, inline code, a heading or a link. */
    private static final Pattern MARKUP = Pattern.compile("\\*\\*|__|`|^#|\\[[^\\]]*\\]\\(");

    @Test
    void titlesAndBodiesInTheExamplesArePlainText() throws IOException {
        String readme = Files.readString(Path.of("README.md"));

        List<String> fields = new ArrayList<>();
        List<String> marked = new ArrayList<>();
        Matcher field = TEXT_FIELD.matcher(readme);
        while (field.find()) {
            fields.add(field.group());
            if (MARKUP.matcher(field.group(2)).find()) {
                marked.add(field.group());
            }
        }

        assertThat(fields).as("title and body fields in the README's examples").isNotEmpty();
        assertThat(marked).as("Markdown in a plain-text field").isEmpty();
    }
}
