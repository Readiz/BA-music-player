package com.readiz.music;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.drawable.BitmapDrawable;
import android.widget.ImageView;
import android.content.res.Configuration;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.widget.RemoteViews;
import android.widget.TextView;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35)
public class MusicWidgetSizesTest {
    private final MediaItem track = new MediaItem.Builder().setMediaId("long-title")
            .setMediaMetadata(new MediaMetadata.Builder().setTitle("길고 긴 곡명 · History of the Moon — 테스트 음악")
                    .setArtist("아티스트 이름도 아주 길 때").build()).build();
    private View render(Context context, RemoteViews remote, int width, int height) {
        View view = remote.apply(context, null);
        float density = context.getResources().getDisplayMetrics().density;
        int w = Math.round(width * density), h = Math.round(height * density);
        view.measure(View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY),
                View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY));
        view.layout(0, 0, w, h);
        return view;
    }
    private void inside(View root, View view) {
        for (View current = view; current != null; current = current.getParent() instanceof View ? (View) current.getParent() : null)
            if (current.getVisibility() != View.VISIBLE) return;
        android.graphics.Rect rect = new android.graphics.Rect(0, 0, view.getWidth(), view.getHeight());
        ((ViewGroup) root).offsetDescendantRectToMyCoords(view, rect);
        assertTrue("visible control must fit: " + rect, rect.left >= 0 && rect.top >= 0
                && rect.right <= root.getWidth() && rect.bottom <= root.getHeight());
        assertTrue("visible control needs a touch area", view.getWidth() > 0 && view.getHeight() > 0);
    }
    @Test public void controlsFitFromMinimumSingleRowToLargeWithLongTitles() {
        Context context = RuntimeEnvironment.getApplication();
        for (boolean rowOnly : new boolean[] {false, true})
            for (int width : new int[] {110, 130, 164, 200, 232, 300, 420})
                for (int height : new int[] {48, 70, 100, 148, 220}) {
                    View view = render(context, MusicWidget.views(context, track, true, "", null, width, height, rowOnly), width, height);
                    for (int id : new int[] {R.id.widget_cover, R.id.widget_title, R.id.widget_artist, R.id.widget_toggle, R.id.widget_previous, R.id.widget_next})
                        inside(view, view.findViewById(id));
                    assertEquals(View.VISIBLE, view.findViewById(R.id.widget_cover).getVisibility());
                    assertTrue(view.findViewById(R.id.widget_toggle).isEnabled());
                    assertTrue(view.findViewById(R.id.widget_info).getContentDescription().toString().contains("History of the Moon"));
                }
    }
    @Test public void narrowRowsKeepPlayAndRevealMoreControlsAsSpaceAllows() {
        Context context = RuntimeEnvironment.getApplication();
        View mini = render(context, MusicWidget.views(context, track, false, "", null, 130, 48, true), 130, 48);
        assertEquals(View.GONE, mini.findViewById(R.id.widget_previous).getVisibility());
        assertEquals(View.GONE, mini.findViewById(R.id.widget_next).getVisibility());
        assertEquals(View.GONE, mini.findViewById(R.id.widget_text).getVisibility());
        View title = render(context, MusicWidget.views(context, track, false, "", null, 164, 48, true), 164, 48);
        assertEquals(View.VISIBLE, title.findViewById(R.id.widget_text).getVisibility());
        assertEquals(View.GONE, title.findViewById(R.id.widget_next).getVisibility());
        View medium = render(context, MusicWidget.views(context, track, false, "", null, 232, 48, true), 232, 48);
        assertEquals(View.VISIBLE, medium.findViewById(R.id.widget_next).getVisibility());
        assertEquals(View.GONE, medium.findViewById(R.id.widget_previous).getVisibility());
        View wide = render(context, MusicWidget.views(context, track, false, "", null, 300, 48, true), 300, 48);
        assertEquals(View.VISIBLE, wide.findViewById(R.id.widget_previous).getVisibility());
        assertEquals(View.VISIBLE, wide.findViewById(R.id.widget_cover).getVisibility());
    }
    @Test public void albumBitmapSurvivesResizingInsteadOfBeingHidden() {
        Context context = RuntimeEnvironment.getApplication();
        Bitmap cover = Bitmap.createBitmap(64, 64, Bitmap.Config.ARGB_8888);
        cover.eraseColor(android.graphics.Color.BLUE);
        for (int width : new int[] {110, 130, 164, 232, 300}) {
            View view = render(context, MusicWidget.views(context, track, false, "", cover, width, 48, true), width, 48);
            ImageView image = view.findViewById(R.id.widget_cover);
            assertEquals(View.VISIBLE, image.getVisibility());
            inside(view, image);
            assertSame(cover, ((BitmapDrawable) image.getDrawable()).getBitmap());
        }
    }
    @Test public void expandedTextStillFitsTheOneRowHeight() {
        Configuration config = new Configuration(RuntimeEnvironment.getApplication().getResources().getConfiguration());
        config.fontScale = 1.3f;
        Context context = RuntimeEnvironment.getApplication().createConfigurationContext(config);
        View view = render(context, MusicWidget.views(context, track, false, "", null, 300, 48, true), 300, 48);
        inside(view, view.findViewById(R.id.widget_title));
        inside(view, view.findViewById(R.id.widget_artist));
    }
    @Test @Config(sdk = 30) public void oldLauncherUsesEachOrientationSizeWithoutASecondRow() {
        Context context = RuntimeEnvironment.getApplication();
        Bundle options = new Bundle();
        options.putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 130);
        options.putInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH, 300);
        options.putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 48);
        options.putInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 90);
        RemoteViews remote = MusicWidget.sizedViews(context, options, false, track, false, "", null);
        View portrait = render(context, remote, 130, 90);
        assertEquals(View.GONE, portrait.findViewById(R.id.widget_next).getVisibility());
        Configuration config = new Configuration(context.getResources().getConfiguration());
        config.orientation = Configuration.ORIENTATION_LANDSCAPE;
        View landscape = render(context.createConfigurationContext(config), remote, 300, 48);
        assertEquals(View.VISIBLE, landscape.findViewById(R.id.widget_previous).getVisibility());
        inside(landscape, landscape.findViewById(R.id.widget_toggle));
        assertEquals(1, ((TextView) landscape.findViewById(R.id.widget_title)).getMaxLines());
    }
}
