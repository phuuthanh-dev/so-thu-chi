import React from "react";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen} from "@testing-library/react";
import {PullToRefresh} from "../src/app/pull-to-refresh";
const touch=(x:number,y:number)=>({clientX:x,clientY:y,identifier:1});
function start(target:Element= document.body){fireEvent.touchStart(target,{touches:[touch(100,20)]});}
function move(target:Element= document.body,y=110,x=100){fireEvent.touchMove(target,{touches:[touch(x,y)]});}
function end(target:Element=document.body){fireEvent.touchEnd(target,{touches:[],changedTouches:[touch(100,110)]});}
beforeEach(()=>{Object.defineProperty(window,"innerWidth",{configurable:true,value:375});Object.defineProperty(window,"scrollY",{configurable:true,value:0});});
afterEach(()=>{cleanup();vi.useRealTimers();});
it("làm mới chỉ khi kéo đủ xa từ đầu trang và thả tay",()=>{
 const reload=vi.fn();render(<PullToRefresh isBlocked={()=>false} reload={reload}/>);
 start();move(document.body,60);end();expect(reload).not.toHaveBeenCalled();
 start();move();expect(screen.getByText("Thả để làm mới")).toBeTruthy();end();expect(reload).toHaveBeenCalledOnce();
});
it("không làm mới khi đang lưu hoặc có nội dung đang sửa",()=>{
 const reload=vi.fn();render(<PullToRefresh isBlocked={()=>true} reload={reload}/>);
 start();move();expect(screen.getByText("Hãy lưu hoặc đóng nội dung đang sửa")).toBeTruthy();end();expect(reload).not.toHaveBeenCalled();
 const event=new Event("beforeunload",{cancelable:true});window.dispatchEvent(event);expect(event.defaultPrevented).toBe(true);
});
it("không kích hoạt khi cuộn trang, kéo ngang, dùng nhiều ngón hoặc bắt đầu trên điều khiển",()=>{
 const reload=vi.fn();render(<><button>Bấm</button><PullToRefresh isBlocked={()=>false} reload={reload}/></>);
 Object.defineProperty(window,"scrollY",{configurable:true,value:25});start();move();end();
 Object.defineProperty(window,"scrollY",{configurable:true,value:0});start();move(document.body,25,200);end();
 fireEvent.touchStart(document.body,{touches:[touch(1,1),touch(2,2)]});move();end();
 start(screen.getByText("Bấm"));move(screen.getByText("Bấm"));end(screen.getByText("Bấm"));
 expect(reload).not.toHaveBeenCalled();
});
it("không cướp thao tác trong vùng cuộn lồng nhau",()=>{
 const reload=vi.fn();const view=render(<><div data-testid="scroller" style={{overflowY:"auto"}}><div>Danh sách</div></div><PullToRefresh isBlocked={()=>false} reload={reload}/></>);
 const scroller=view.getByTestId("scroller");Object.defineProperty(scroller,"scrollHeight",{value:500});Object.defineProperty(scroller,"clientHeight",{value:100});
 start(scroller);move(scroller);end(scroller);expect(reload).not.toHaveBeenCalled();
});
it("kiểm tra lại trạng thái đang lưu khi người dùng thả tay",()=>{
 let blocked=false;const reload=vi.fn();render(<PullToRefresh isBlocked={()=>blocked} reload={reload}/>);
 start();move();blocked=true;end();expect(reload).not.toHaveBeenCalled();expect(screen.getByText("Hãy lưu hoặc đóng nội dung đang sửa")).toBeTruthy();
});
it("hủy cử chỉ không làm mới",()=>{
 const reload=vi.fn();render(<PullToRefresh isBlocked={()=>false} reload={reload}/>);
 start();move();fireEvent.touchCancel(document.body);end();expect(reload).not.toHaveBeenCalled();
});

it("không làm mới nếu thêm ngón thứ hai trong khi kéo",()=>{
 const reload=vi.fn();render(<PullToRefresh isBlocked={()=>false} reload={reload}/>);
 start();move();fireEvent.touchStart(document.body,{touches:[touch(100,110),touch(120,110)]});
 fireEvent.touchEnd(document.body,{touches:[touch(100,110)]});end();expect(reload).not.toHaveBeenCalled();
});
