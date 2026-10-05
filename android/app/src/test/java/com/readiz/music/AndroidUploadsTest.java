package com.readiz.music;

import android.content.Intent;
import android.net.Uri;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import androidx.activity.ComponentActivity;
import java.util.ArrayList;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35)
public class AndroidUploadsTest {
    private WebChromeClient.FileChooserParams params() {
        return new WebChromeClient.FileChooserParams() {
            public int getMode() { return MODE_OPEN; }
            public String[] getAcceptTypes() { return new String[] { "audio/*" }; }
            public boolean isCaptureEnabled() { return false; }
            public CharSequence getTitle() { return null; }
            public String getFilenameHint() { return null; }
            public Intent createIntent() { return new Intent(Intent.ACTION_OPEN_DOCUMENT); }
        };
    }
    @Test public void onlyMusicOriginCanChooseAndCancellationSettlesCallback() {
        try (var controller = Robolectric.buildActivity(ComponentActivity.class).create()) {
            var host = controller.get();
            WebView web = new WebView(host);
            AndroidUploads uploads = new AndroidUploads(host, web);
            ArrayList<Uri[]> results = new ArrayList<>();
            web.loadUrl("https://evil.example/");
            assertFalse(uploads.onShowFileChooser(web, results::add, params()));
            assertTrue(results.isEmpty());
            web.loadUrl("https://music.readiz.com/");
            assertTrue(uploads.onShowFileChooser(web, results::add, params()));
            Intent intent = Shadows.shadowOf(host).getNextStartedActivityForResult().intent;
            assertEquals(Intent.ACTION_OPEN_DOCUMENT, intent.getAction());
            assertFalse(intent.getBooleanExtra(Intent.EXTRA_ALLOW_MULTIPLE, false));
            assertArrayEquals(new String[] { "audio/*", "video/mp4", "video/webm", "application/ogg" }, intent.getStringArrayExtra(Intent.EXTRA_MIME_TYPES));
            uploads.selected(null);
            assertEquals(1, results.size()); assertNull(results.get(0));
            uploads.close(); assertEquals(1, results.size());
            uploads.onShowFileChooser(web, results::add, params());
            uploads.selected(Uri.parse("file:///data/private"));
            assertNull(results.get(1));
            uploads.onShowFileChooser(web, results::add, params());
            web.loadUrl("https://evil.example/");
            uploads.selected(Uri.parse("content://documents/song"));
            assertNull(results.get(2));
        }
    }
    @Test public void originCheckRejectsLookalikesAndCredentials() {
        assertTrue(AndroidUploads.trusted("https://music.readiz.com:443/"));
        for (String url : new String[] { null, "http://music.readiz.com", "https://music.readiz.com.evil/", "https://user@music.readiz.com/", "https://music.readiz.com:444/", "file:///song" }) assertFalse(AndroidUploads.trusted(url));
    }
}
