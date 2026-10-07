package com.readiz.music;

import android.content.Context;
import android.os.Bundle;
import android.view.View;
import android.widget.ImageButton;
import android.widget.TextView;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.ExoPlayer;
import java.util.List;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.Robolectric;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35)
public class MusicWidgetTest {
    private Context context;
    private ExoPlayer player;
    private MediaItem track(String id) {
        return new MediaItem.Builder().setMediaId(id).setUri("https://music.readiz.com/music/ETC/" + id + ".mp3")
                .setMediaMetadata(new MediaMetadata.Builder().setTitle("테스트 곡 " + id).setArtist("아티스트").build()).build();
    }
    @Before public void setUp() {
        context = RuntimeEnvironment.getApplication();
        context.getSharedPreferences(PlaybackSnapshot.PREFERENCES, 0).edit().clear().commit();
        player = new ExoPlayer.Builder(context).build();
    }
    @After public void tearDown() { player.release(); }
    @Test public void restoresOrderPositionAndOptionsWithoutAutoplay() {
        player.setMediaItems(List.of(track("a"), track("b")), 1, 12345);
        Bundle options = new Bundle();
        options.putBoolean("repeat", true);
        options.putBoolean("autoNext", false);
        options.putBoolean("random", false);
        PlaybackSnapshot.save(context, player, options);
        PlaybackSnapshot saved = PlaybackSnapshot.load(context);
        assertEquals(2, saved.items.size());
        assertEquals("b", saved.items.get(saved.index).mediaId);
        assertEquals(12345, saved.position);
        assertTrue(saved.options.getBoolean("repeat"));
        assertFalse(saved.options.getBoolean("autoNext"));
        assertFalse(saved.options.getBoolean("random"));
        assertEquals("테스트 곡 b", saved.items.get(1).mediaMetadata.title.toString());
        assertFalse(player.getPlayWhenReady());
        player.clearMediaItems();
        PlaybackSnapshot.save(context, player, options);
        assertTrue(PlaybackSnapshot.load(context).items.isEmpty());
    }
    @Test public void serviceRestoresSavedQueuePausedAndReleasesWidgetPlayer() {
        player.setMediaItems(List.of(track("a"), track("b")), 1, 9000);
        Bundle options = new Bundle();
        options.putBoolean("repeat", true);
        PlaybackSnapshot.save(context, player, options);
        var service = Robolectric.buildService(PlaybackService.class).create();
        try {
            Player restored = PlaybackService.widgetPlayer();
            assertEquals("b", restored.getCurrentMediaItem().mediaId);
            assertEquals(9000, restored.getCurrentPosition());
            assertEquals(Player.REPEAT_MODE_ONE, restored.getRepeatMode());
            assertFalse(restored.getPlayWhenReady());
        } finally { service.destroy(); }
        assertNull(PlaybackService.widgetPlayer());
        assertEquals("b", PlaybackSnapshot.load(context).items.get(1).mediaId);
    }
    @Test public void rejectsCorruptAndUntrustedSavedQueues() {
        for (String raw : new String[] {"broken", "{\"tracks\":[{\"id\":\"bad\",\"src\":\"https://evil.test/music/a.mp3\"}],\"index\":0}",
                "{\"tracks\":[],\"index\":5}"}) {
            context.getSharedPreferences(PlaybackSnapshot.PREFERENCES, 0).edit().putString("snapshot", raw).commit();
            assertTrue(PlaybackSnapshot.load(context).items.isEmpty());
        }
    }
    @Test public void emptyWidgetOpensAppAndDisablesSkipping() {
        View view = MusicWidget.views(context, null, false, "", null).apply(context, null);
        assertFalse(view.findViewById(R.id.widget_previous).isEnabled());
        assertFalse(view.findViewById(R.id.widget_next).isEnabled());
        view.findViewById(R.id.widget_toggle).performClick();
        assertEquals(MainActivity.class.getName(), Shadows.shadowOf(RuntimeEnvironment.getApplication())
                .getNextStartedActivity().getComponent().getClassName());
    }
    @Test public void showsCurrentTrackErrorAndPauseAccessibilityLabel() {
        View view = MusicWidget.views(context, track("b"), true, "재생 오류", null).apply(context, null);
        assertEquals("테스트 곡 b", ((TextView) view.findViewById(R.id.widget_title)).getText().toString());
        assertEquals("재생 오류", ((TextView) view.findViewById(R.id.widget_artist)).getText().toString());
        assertEquals("일시정지", ((ImageButton) view.findViewById(R.id.widget_toggle)).getContentDescription().toString());
        assertTrue(view.findViewById(R.id.widget_previous).isEnabled());
    }
    @Test public void toggleAndSkipControlTheSamePlayerQueue() {
        player.setMediaItems(List.of(track("a"), track("b")));
        player.setRepeatMode(Player.REPEAT_MODE_ALL);
        MusicWidget.applyCommand(player, MusicWidget.NEXT);
        assertEquals("b", player.getCurrentMediaItem().mediaId);
        assertTrue(player.getPlayWhenReady());
        MusicWidget.applyCommand(player, MusicWidget.TOGGLE);
        assertFalse(player.getPlayWhenReady());
        MusicWidget.applyCommand(player, MusicWidget.PREVIOUS);
        assertEquals("a", player.getCurrentMediaItem().mediaId);
        assertTrue(player.getPlayWhenReady());
        MusicWidget.applyCommand(player, MusicWidget.PREVIOUS);
        assertEquals("b", player.getCurrentMediaItem().mediaId);
    }
}
