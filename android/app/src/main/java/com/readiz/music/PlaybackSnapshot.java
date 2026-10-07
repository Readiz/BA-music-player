package com.readiz.music;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Bundle;
import androidx.media3.common.MediaItem;
import androidx.media3.common.Player;
import java.util.ArrayList;
import org.json.JSONArray;
import org.json.JSONObject;

/** Only the queue and listening position are persisted; never a playing flag. */
@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
final class PlaybackSnapshot {
    static final String PREFERENCES = "playback-resumption";
    final ArrayList<MediaItem> items;
    final int index;
    final long position;
    final Bundle options;

    PlaybackSnapshot(ArrayList<MediaItem> items, int index, long position, Bundle options) {
        this.items = items;
        this.index = index;
        this.position = position;
        this.options = options;
    }
    static PlaybackSnapshot empty() { return new PlaybackSnapshot(new ArrayList<>(), 0, 0, new Bundle()); }
    static PlaybackSnapshot load(Context context) {
        String raw = preferences(context).getString("snapshot", "");
        if (raw.isEmpty() || raw.length() > 1_000_000) return empty();
        try {
            JSONObject value = new JSONObject(raw);
            ArrayList<MediaItem> items = PlaybackBridge.parseQueue(value.getJSONArray("tracks"));
            int index = value.getInt("index");
            if (items.isEmpty() || index < 0 || index >= items.size()) return empty();
            Bundle options = new Bundle();
            options.putBoolean("repeat", value.optBoolean("repeat", false));
            options.putBoolean("autoNext", value.optBoolean("autoNext", true));
            options.putBoolean("random", value.optBoolean("random", true));
            return new PlaybackSnapshot(items, index, Math.max(0, value.optLong("position", 0)), options);
        } catch (Exception ignored) { return empty(); }
    }
    static void save(Context context, Player player, Bundle options) {
        if (player.getMediaItemCount() == 0) {
            preferences(context).edit().remove("snapshot").apply();
            return;
        }
        try {
            JSONArray tracks = new JSONArray();
            for (int i = 0; i < player.getMediaItemCount(); i++) {
                MediaItem item = player.getMediaItemAt(i);
                if (item.localConfiguration == null || !PlaybackBridge.mediaUrl(item.localConfiguration.uri)) return;
                var metadata = item.mediaMetadata;
                tracks.put(new JSONObject().put("id", item.mediaId).put("src", item.localConfiguration.uri.toString())
                        .put("title", metadata.title).put("artist", metadata.artist).put("folder", metadata.albumTitle)
                        .put("artwork", metadata.artworkUri == null ? "" : metadata.artworkUri.toString()));
            }
            String raw = new JSONObject().put("tracks", tracks).put("index", player.getCurrentMediaItemIndex())
                    .put("position", Math.max(0, player.getCurrentPosition()))
                    .put("repeat", options.getBoolean("repeat", false)).put("autoNext", options.getBoolean("autoNext", true))
                    .put("random", options.getBoolean("random", true)).toString();
            if (raw.length() <= 1_000_000) preferences(context).edit().putString("snapshot", raw).apply();
        } catch (Exception ignored) { /* Keep the last complete snapshot. */ }
    }
    private static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
    }
}
