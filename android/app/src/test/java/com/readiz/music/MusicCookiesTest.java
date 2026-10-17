package com.readiz.music;
import static org.junit.Assert.*;
import android.net.Uri;
import android.webkit.CookieManager;
import java.util.Map;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35)
public class MusicCookiesTest {
    @Test public void onlyMusicAudioReceivesTheCurrentMusicSession() {
        String token = "a".repeat(43);
        CookieManager.getInstance().setCookie("https://music.readiz.com/", "__Host-readiz_music_session="+token+"; Secure; HttpOnly; Path=/");
        assertEquals("__Host-readiz_music_session="+token, MusicCookies.headers(Uri.parse("https://music.readiz.com/music/ETC/test.mp3"), Map.of()).get("Cookie"));
        assertEquals("__Host-readiz_music_session="+token, MusicCookies.headers(Uri.parse("https://music.readiz.com/assets/albums/etc.jpg"), Map.of()).get("Cookie"));
        for (String url : new String[]{"https://evil.example/music/test.mp3", "https://music.readiz.com.evil.example/music/test.mp3", "http://music.readiz.com/music/test.mp3", "https://music.readiz.com/app.apk", "https://music.readiz.com:444/music/test.mp3"})
            assertFalse(url, MusicCookies.headers(Uri.parse(url), Map.of("Cookie", "old-session")).containsKey("Cookie"));
        CookieManager.getInstance().removeAllCookies(null);
        assertFalse(MusicCookies.headers(Uri.parse("https://music.readiz.com/music/ETC/test.mp3"), Map.of()).containsKey("Cookie"));
    }
}
