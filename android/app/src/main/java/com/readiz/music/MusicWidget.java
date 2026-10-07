package com.readiz.music;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.widget.RemoteViews;
import androidx.core.content.ContextCompat;
import androidx.media3.common.MediaItem;
import androidx.media3.common.Player;
import androidx.media3.session.MediaController;
import androidx.media3.session.SessionToken;
import com.google.common.util.concurrent.ListenableFuture;
import java.io.ByteArrayOutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** A private receiver: launcher buttons carry immutable, explicit PendingIntents. */
@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
public final class MusicWidget extends AppWidgetProvider {
    static final String TOGGLE = "com.readiz.music.widget.TOGGLE";
    static final String PREVIOUS = "com.readiz.music.widget.PREVIOUS";
    static final String NEXT = "com.readiz.music.widget.NEXT";
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static final ExecutorService ARTWORK = Executors.newSingleThreadExecutor();
    private static String artworkKey = "";
    private static Bitmap artwork;

    @Override public void onUpdate(Context context, AppWidgetManager manager, int[] ids) { updateAll(context); }
    @Override public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, Bundle options) { updateAll(context); }
    @Override public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        String action = intent.getAction();
        if (!TOGGLE.equals(action) && !PREVIOUS.equals(action) && !NEXT.equals(action)) return;
        PendingResult pending = goAsync();
        ListenableFuture<MediaController> future;
        try {
            future = new MediaController.Builder(context.getApplicationContext(),
                    new SessionToken(context.getApplicationContext(), new ComponentName(context, PlaybackService.class))).buildAsync();
        } catch (RuntimeException unavailable) {
            pending.finish();
            updateAll(context);
            return;
        }
        boolean[] finished = {false};
        Runnable finish = () -> {
            if (finished[0]) return;
            finished[0] = true;
            MediaController.releaseFuture(future);
            pending.finish();
        };
        // A broken session must not leave the broadcast receiver alive indefinitely.
        MAIN.postDelayed(finish, 8000);
        future.addListener(() -> {
            if (finished[0]) return;
            try {
                MediaController controller = future.get();
                applyCommand(controller, action);
                updateAll(context);
            } catch (Exception ignored) { updateAll(context); }
            finally { MAIN.removeCallbacks(finish); finish.run(); }
        }, ContextCompat.getMainExecutor(context));
    }
    static void applyCommand(Player player, String action) {
        if (player.getMediaItemCount() == 0) return;
        if (TOGGLE.equals(action) && wantsPlayback(player)) { player.pause(); return; }
        if (PREVIOUS.equals(action)) player.seekToPreviousMediaItem();
        else if (NEXT.equals(action)) player.seekToNextMediaItem();
        else if (!TOGGLE.equals(action)) return;
        if (player.getPlaybackState() == Player.STATE_ENDED) player.seekToDefaultPosition();
        player.prepare();
        player.play();
    }
    static boolean wantsPlayback(Player player) {
        return player.getPlayWhenReady() && player.getPlaybackState() != Player.STATE_ENDED && player.getPlayerError() == null;
    }
    static void updateAll(Context context) {
        Context app = context.getApplicationContext();
        AppWidgetManager manager = AppWidgetManager.getInstance(app);
        int[] ids = manager.getAppWidgetIds(new ComponentName(app, MusicWidget.class));
        if (ids.length == 0) return;
        Player player = PlaybackService.widgetPlayer();
        MediaItem item;
        boolean playing = false;
        String message = "";
        if (player != null) {
            item = player.getCurrentMediaItem();
            playing = wantsPlayback(player);
            if (player.getPlayerError() != null) message = app.getString(R.string.widget_error);
            else if (player.getPlaybackState() == Player.STATE_BUFFERING) message = app.getString(R.string.widget_loading);
        } else {
            PlaybackSnapshot saved = PlaybackSnapshot.load(app);
            item = saved.items.isEmpty() ? null : saved.items.get(saved.index);
        }
        String key = item == null || item.mediaMetadata.artworkUri == null ? "" : item.mediaMetadata.artworkUri.toString();
        if (!key.equals(artworkKey)) {
            artworkKey = key;
            artwork = null;
            if (!key.isEmpty()) {
                ARTWORK.execute(() -> {
                    Bitmap loaded = loadArtwork(key);
                    MAIN.post(() -> {
                        if (!key.equals(artworkKey)) return;
                        artwork = loaded;
                        if (loaded != null) updateAll(app);
                    });
                });
            }
        }
        manager.updateAppWidget(ids, views(app, item, playing, message, artwork));
    }
    static RemoteViews views(Context context, MediaItem item, boolean playing, String message, Bitmap cover) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.music_widget);
        PendingIntent open = PendingIntent.getActivity(context, 40,
                new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.widget_info, open);
        views.setTextViewText(R.id.widget_title, item == null || item.mediaMetadata.title == null
                ? context.getString(R.string.widget_name) : item.mediaMetadata.title);
        CharSequence subtitle = item == null ? context.getString(R.string.widget_empty) : item.mediaMetadata.artist;
        if (item != null && (subtitle == null || subtitle.length() == 0)) subtitle = item.mediaMetadata.albumTitle;
        views.setTextViewText(R.id.widget_artist, message.isEmpty() ? subtitle : message);
        if (cover != null) views.setImageViewBitmap(R.id.widget_cover, cover);
        else views.setImageViewResource(R.id.widget_cover, R.drawable.music_icon);
        views.setImageViewResource(R.id.widget_toggle, playing ? R.drawable.widget_pause : R.drawable.widget_play);
        views.setContentDescription(R.id.widget_toggle, context.getString(playing ? R.string.widget_pause : R.string.widget_play));
        views.setOnClickPendingIntent(R.id.widget_toggle, item == null ? open : command(context, TOGGLE, 41));
        views.setOnClickPendingIntent(R.id.widget_previous, command(context, PREVIOUS, 42));
        views.setOnClickPendingIntent(R.id.widget_next, command(context, NEXT, 43));
        for (int id : new int[] { R.id.widget_previous, R.id.widget_next }) {
            views.setBoolean(id, "setEnabled", item != null);
            views.setFloat(id, "setAlpha", item == null ? 0.35f : 1f);
        }
        return views;
    }
    private static PendingIntent command(Context context, String action, int code) {
        return PendingIntent.getBroadcast(context, code, new Intent(context, MusicWidget.class).setAction(action),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
    private static Bitmap loadArtwork(String value) {
        Uri uri = Uri.parse(value);
        if (!PlaybackBridge.trusted(uri) || uri.getPath() == null || !uri.getPath().startsWith("/assets/albums/")
                || uri.getPath().contains("/../") || uri.getQuery() != null || uri.getFragment() != null) return null;
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(value).openConnection();
            connection.setConnectTimeout(4000);
            connection.setReadTimeout(4000);
            connection.setInstanceFollowRedirects(false);
            if (connection.getResponseCode() != 200 || connection.getContentLength() > 2_000_000) return null;
            byte[] bytes;
            try (var input = connection.getInputStream(); var output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192];
                int size;
                while ((size = input.read(buffer)) != -1) {
                    if (output.size() + size > 2_000_000) return null;
                    output.write(buffer, 0, size);
                }
                bytes = output.toByteArray();
            }
            BitmapFactory.Options options = new BitmapFactory.Options();
            options.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
            if (options.outWidth <= 0 || options.outHeight <= 0) return null;
            options.inSampleSize = 1;
            while (Math.max(options.outWidth, options.outHeight) / options.inSampleSize > 256) options.inSampleSize *= 2;
            options.inJustDecodeBounds = false;
            return BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
        } catch (Exception ignored) { return null; }
        finally { if (connection != null) connection.disconnect(); }
    }
}
