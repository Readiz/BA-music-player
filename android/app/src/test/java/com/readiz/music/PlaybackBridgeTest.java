package com.readiz.music;

import android.net.Uri;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35)
public class PlaybackBridgeTest {
    @Test public void refusesOtherOriginsFilesAndTraversal() {
        for (String value : new String[] {"http://music.readiz.com/music/a.ogg", "https://music.readiz.com.evil.test/music/a.ogg",
            "https://user@music.readiz.com/music/a.ogg", "file:///music/a.ogg", "https://music.readiz.com:444/music/a.ogg",
            "https://music.readiz.com/music/%2e%2e/private", "https://music.readiz.com/app.apk", "https://music.readiz.com/music/a.ogg?redirect=1"}) {
            assertFalse(value, PlaybackBridge.mediaUrl(Uri.parse(value)));
        }
    }
    @Test public void preservesQueueOrderUnicodeMetadataAndArtwork() throws Exception {
        JSONArray queue = new JSONArray();
        for (String id : new String[] {"./music/Blue%20Archive/theme_179.ogg", "./music/ETC/노래.mp3"}) {
            queue.put(new JSONObject().put("id", id).put("src", "https://music.readiz.com/" + id.substring(2))
                .put("title", "夢路の花").put("artist", "Blue Archive").put("folder", "Blue Archive")
                .put("artwork", "https://music.readiz.com/assets/albums/blue-archive.jpg"));
        }
        var items = PlaybackBridge.parseQueue(queue);
        assertEquals(2, items.size());
        assertEquals(queue.getJSONObject(1).getString("id"), items.get(1).mediaId);
        assertEquals("夢路の花", items.get(0).mediaMetadata.title);
        assertEquals("https://music.readiz.com/assets/albums/blue-archive.jpg", items.get(0).mediaMetadata.artworkUri.toString());
        queue.getJSONObject(0).put("src", "https://evil.test/track.mp3");
        assertThrows(IllegalArgumentException.class, () -> PlaybackBridge.parseQueue(queue));
    }
}
