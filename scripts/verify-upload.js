// Playwright CLI run-code against the isolated upload fixture on port 4543.
async page => {
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const assert=(value,message)=>{if(!value)throw new Error(message);};
  await page.route('https://music.readiz.com/**',async route=>{
    const url=new URL(route.request().url());
    const response=await page.request.get('http://127.0.0.1:4543/__pages/'+url.pathname.slice(1)+url.search);
    await route.fulfill({response,headers:{...response.headers(),'access-control-allow-origin':'*'}});
  });
  await page.goto('http://127.0.0.1:4543/');
  await page.setViewportSize({width:1280,height:900});
  await page.getByRole('button',{name:'음악 추가',exact:true}).click();
  await page.getByRole('link',{name:'디스코드로 로그인'}).waitFor();
  assert(!await page.getByLabel('음악 파일',{exact:true}).isVisible(),'Guest sees upload');
  assert((await page.request.post('http://127.0.0.1:4543/api/uploads?name=test.wav',{data:'test',headers:{'content-type':'application/octet-stream'}})).status()===401,'Guest can upload');
  await page.goto('http://127.0.0.1:4543/__login');
  await page.getByRole('button',{name:'파일 업로드',exact:true}).click();
  await page.getByLabel('음악 파일',{exact:true}).setInputFiles('output/playwright/music-upload/sample.wav');
  assert(await page.getByLabel('곡 제목',{exact:true}).inputValue()==='sample','Filename title not prefilled');
  await page.getByLabel('곡 제목',{exact:true}).fill('업로드 검증 <script>');
  await page.getByRole('button',{name:'파일을 ETC에 추가'}).click();
  await page.getByText('동기화 완료 · ETC에 추가됨',{exact:true}).waitFor({timeout:15000});
  assert(await page.locator('.music-add-jobs strong').first().textContent()==='업로드 검증 <script>','Unsafe or incorrect title');
  await page.screenshot({path:'output/playwright/music-upload/desktop.png'});
  await page.getByRole('button',{name:'듣기',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#audio').src.includes('/upload-')&&!document.querySelector('#audio').paused&&document.querySelector('#audio').currentTime>0.2&&!document.querySelector('#audio').error);
  await page.getByRole('button',{name:'음악 추가',exact:true}).click();
  await page.getByLabel('음악 파일',{exact:true}).setInputFiles('output/playwright/music-upload/sample.wav');
  await page.getByRole('button',{name:'파일을 ETC에 추가'}).click();
  await page.getByText('이미 ETC에 있는 곡입니다. 바로 들을 수 있습니다.',{exact:true}).waitFor();
  assert(await page.locator('.music-add-jobs li').count()===1,'Duplicate file added');
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'output/playwright/music-upload/mobile.png'});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Horizontal overflow');
  await page.getByRole('button',{name:'로그아웃',exact:true}).click();
  await page.getByRole('link',{name:'디스코드로 로그인'}).waitFor();
  await page.getByRole('button',{name:'음악 추가 닫기'}).click();
  await page.reload();
  await page.getByRole('button',{name:'전체 해제',exact:true}).click();
  await page.getByRole('checkbox',{name:'ETC',exact:true}).check();
  await page.locator('#ulist li').filter({hasText:'업로드 검증 <script>'}).click();
  await page.waitForFunction(()=>document.querySelector('#audio').src.includes('/upload-')&&!document.querySelector('#audio').paused&&document.querySelector('#audio').currentTime>0.2&&!document.querySelector('#audio').error);
  assert(!errors.length,'Browser errors: '+errors.join(';'));
  return {guestBlocked:true,fileTransmittedAndConverted:true,readyPlayback:true,deduplication:true,mobileLayout:true,anonymousPlayback:true,errors};
}
