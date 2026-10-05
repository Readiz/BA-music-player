package com.readiz.music;

import android.view.Display;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import org.robolectric.util.ReflectionHelpers;
import static org.robolectric.util.ReflectionHelpers.ClassParameter.from;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class TvDisplayTest {
    private Display.Mode mode(int id, int width, int height, float hz) {
        return ReflectionHelpers.callConstructor(Display.Mode.class,
                from(int.class, id), from(int.class, width), from(int.class, height), from(float.class, hz));
    }

    @Test public void lowResolutionPrefersFullHdAndClosestRefreshRate() {
        Display.Mode hd = mode(1, 1280, 720, 59.94f);
        Display.Mode[] modes = { mode(2, 3840, 2160, 60), mode(3, 1920, 1080, 50),
                mode(4, 1920, 1080, 60), mode(5, 1920, 1080, 59.94f), hd };
        assertEquals(5, MainActivity.preferredTvModeId(hd, modes));
    }

    @Test public void alreadyFullHdOrHigherKeepsCurrentMode() {
        Display.Mode fhd = mode(2, 1920, 1080, 60);
        Display.Mode uhd = mode(3, 3840, 2160, 60);
        assertEquals(0, MainActivity.preferredTvModeId(fhd, new Display.Mode[] { uhd, fhd }));
        assertEquals(0, MainActivity.preferredTvModeId(uhd, new Display.Mode[] { fhd, uhd }));
    }

    @Test public void fallsBackToSmallestHigherModeWhenFullHdIsUnavailable() {
        Display.Mode hd = mode(1, 1280, 720, 60);
        assertEquals(3, MainActivity.preferredTvModeId(hd, new Display.Mode[] {
                mode(2, 3840, 2160, 60), mode(3, 2560, 1440, 60), hd }));
    }

    @Test public void unsupportedPanelsKeepCurrentMode() {
        Display.Mode hd = mode(1, 1280, 720, 60);
        assertEquals(0, MainActivity.preferredTvModeId(hd, new Display.Mode[] {
                hd, mode(2, 1920, 720, 60), mode(3, 1440, 1080, 60) }));
        assertEquals(0, MainActivity.preferredTvModeId(hd, new Display.Mode[0]));
    }
}
