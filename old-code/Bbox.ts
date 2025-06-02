import { AlignType, CtrlType, Events, Shape } from "../../Constants";
import { IPixelPos, IVctor, Paint } from "../../Interface";
import Layer from "../../Layer";
import { scene } from "../../Scene";
import { Utils } from "../../utils";
import Line from "../basic-shape/Line";
import Pnt from "../basic-shape/Pnt";
import Rect from "../basic-shape/Rect";
import Feature from "../Feature";

let lastDx = 0;
let lastDy = 0;
const layer = new Layer(Infinity);
layer.name = "bbox"
layer.actived = false;

// 包围盒元素, 形变(放大,缩小)元素用 bbox 始终是矩形
export default class Bbox extends Rect {

    static angleAbsorb = true; // 是否旋转角度的吸附
    static keepRatio = true; // 是否按宽高比例缩放
    static ctrlPSize = 10; // 控制点大小
    static layer = layer;

    bindF: Feature;
    margin = 0;
    hypotenuseVct1: IVctor;  // 对角线向量1
    hypotenuseVct2: IVctor;  // 对角线向量2

    constructor(bindF: Feature, margin = 5) {   // 相对坐标
        if (!bindF.isBasic) throw "元素类型不正确!";
        super(0, 0, 0, 0);
        this.margin = margin;
        this.isBasic = false;
        layer.actived = true;
        this.zIndex = Infinity;
        this.bindF = bindF;
        bindF.bounded = true;
        this.isFixedPos = bindF.isFixedPos;
        this.cbTranslate = bindF.cbTranslate;
        this.angle = bindF.angle;  // 比如要和目标元素同步初始角度
        this.pointArr = this.getBboxWrapPnts(bindF); // 获取包围盒,包括旋转角度
        const { width, height } = this.getRectInfo();
        this.addChild(bindF);
        this.generateCtrlPnts(width, height);
        this.setPnt2BboxPer(this, width, height);
        this.hypotenuseVct1 = Utils.getVector(this.pointArr[0], this.pointArr[2]);
        this.hypotenuseVct2 = Utils.getVector(this.pointArr[1], this.pointArr[3]);
        bindF.on(Events.CHANGE, (e: any) => {  // 元素被动的改变大小时
            this.setPnt2BboxPer(this, width, height);
            this.resize.call(this)
        })
        bindF.on(Events.TRANSLATE, ({ detail }: any) => {  // 元素被动的改变大小时
            this.translate(detail.offsetX, detail.offsetY)
        })
    }

    draw(ctx: CanvasRenderingContext2D, paint: Paint, mousePos?: IPixelPos, redraw = true) {
        this.children.forEach(cd => { if (cd != this.bindF) cd.draw(ctx, cd.getTransformer(paint.tf), mousePos, redraw) })  // 不渲染绑定的元素
    }

    override translate(offsetX: number = 0, offsetY: number = 0) {
        if (!this.cbTranslate) return;
        this.pointArr = this.pointArr.map(p => ({  // pointArr的点
            ...p,
            x: p.x += offsetX,
            y: p.y += offsetY,
        }))
        this.children.forEach(cf => cf != this.bindF && cf.translate(offsetX, offsetY)) // 子元素递归偏移
        this.dispatch(new CustomEvent(Events.TRANSLATE, { detail: { offsetX, offsetY, bindF: this } }))
        return this;
    }

    addChild(feature: Feature) {   // 不要跟其他元素争抢parent,否则会出bug
        if (this.children.includes(feature) || (this === feature)) return;  // 添加是自己或已经存在不添加
        this.children.push(feature);
        return this;
    }

    // 获取父元素pointArr所有点距离包围盒上下百分比
    setPnt2BboxPer(feature: Feature, width = 0, height = 0) {
        feature._pntPerOfBBox = {
            toLeft: [],
            toRight: []
        }
        feature.pointArr.forEach(p => {
            const ldx = Math.abs(Utils.getLenOfPntToSegment(p, this.pointArr[0], this.pointArr[3]));
            const ldy = Math.abs(Utils.getLenOfPntToSegment(p, this.pointArr[0], this.pointArr[1]));
            feature._pntPerOfBBox.toLeft.push({
                x: ldx / width,
                y: ldy / height,
            })
            const rdx = Math.abs(Utils.getLenOfPntToSegment(p, this.pointArr[1], this.pointArr[2]));
            const rdy = Math.abs(Utils.getLenOfPntToSegment(p, this.pointArr[2], this.pointArr[3]));
            feature._pntPerOfBBox.toRight.push({
                x: rdx / width,
                y: rdy / height,
            })
        })
        feature.bezierCtrlPnts.forEach((p, i) => {
            if (p) {
                const ldx = Math.abs(Utils.getLenOfPntToSegment(p, this.pointArr[0], this.pointArr[3]));
                const ldy = Math.abs(Utils.getLenOfPntToSegment(p, this.pointArr[0], this.pointArr[1]));
                feature._bcPerOfBBox.toLeft.push({
                    x: ldx / width,
                    y: ldy / height,
                })
                const rdx = Math.abs(Utils.getLenOfPntToSegment(p, this.pointArr[1], this.pointArr[2]));
                const rdy = Math.abs(Utils.getLenOfPntToSegment(p, this.pointArr[2], this.pointArr[3]));
                feature._bcPerOfBBox.toRight.push({
                    x: rdx / width,
                    y: rdy / height,
                })
            }else {
                feature._bcPerOfBBox.toLeft.push(undefined)
                feature._bcPerOfBBox.toRight.push(undefined)
            }
        })
        feature.children.forEach(f => {
            this.setPnt2BboxPer(f, width, height);
        })
    }

    computeNewPosition(feature: Feature, moved = 0, type: AlignType, ctrlPnt: Pnt, vcts: { x: IVctor, y: IVctor }) {
        const { x: vctX, y: vctY } = vcts
        if (moved == 0 || (!feature.cbTransform && this.bindF === feature)) return;   // cbTransform 只对绑定的元素(第一级)有效, 子元素cbTransform=false情况下没用
        if (feature != scene.focusNode) {
            feature.pointArr.forEach((p, i) => {
                let newPnt = { x: 0, y: 0 }
                switch (type) {
                    case AlignType.LEFT:
                        newPnt = Utils.getPntInVct(p, vctX, moved * -feature._pntPerOfBBox.toRight[i].x);
                        break;
                    case AlignType.RIGHT:
                        newPnt = Utils.getPntInVct(p, vctX, moved * feature._pntPerOfBBox.toLeft[i].x);
                        break;
                    case AlignType.TOP:
                        newPnt = Utils.getPntInVct(p, vctY, moved * -feature._pntPerOfBBox.toRight[i].y);
                        break;
                    case AlignType.BOTTOM:
                        newPnt = Utils.getPntInVct(p, vctY, moved * feature._pntPerOfBBox.toLeft[i].y);
                        break;
                    default:
                        break;
                }
                p.x = newPnt.x;
                p.y = newPnt.y;
            })
            feature.bezierCtrlPnts.forEach((p, i) => {
                if (p) {
                    let newPnt = { x: 0, y: 0 }
                    switch (type) {
                        case AlignType.LEFT:
                            newPnt = Utils.getPntInVct(p, vctX, moved * -feature._bcPerOfBBox.toRight[i].x);
                            break;
                        case AlignType.RIGHT:
                            newPnt = Utils.getPntInVct(p, vctX, moved * feature._bcPerOfBBox.toLeft[i].x);
                            break;
                        case AlignType.TOP:
                            newPnt = Utils.getPntInVct(p, vctY, moved * -feature._bcPerOfBBox.toRight[i].y);
                            break;
                        case AlignType.BOTTOM:
                            newPnt = Utils.getPntInVct(p, vctY, moved * feature._bcPerOfBBox.toLeft[i].y);
                            break;
                        default:
                            break;
                    }
                    p.x = newPnt.x;
                    p.y = newPnt.y;
                }
            })
            if (feature instanceof Rect) {
                const { width: w, height: h, x, y } = feature.getRectInfo();
                feature._width = w;
                feature._height = h;
                feature._x = x;
                feature._y = y;
            }
            feature.dispatch(new CustomEvent(Events.RESIZE, { detail: { trigger: ctrlPnt, target: feature, type: ctrlPnt.type } })) // 所有子元素都resize, 否则link监听不到
            if (feature.cbTransformChild) feature.children.forEach(f => {
                this.computeNewPosition(f, moved, type, ctrlPnt, vcts);
            })
        }
    }

    // 初始化添加控制点
    generateCtrlPnts(width = 0, height = 0, bindF = this.bindF) {
        let vctX: IVctor;
        let vctY: IVctor;
        if (bindF.ctrlTypes.includes(CtrlType.SIZE_CTRL)) {
            this.pointArr.forEach((p, i) => {
                const ctrlPnt = new Pnt(p.x, p.y, Bbox.ctrlPSize, Bbox.ctrlPSize);
                ctrlPnt.isBasic = false;
                this.addChild(ctrlPnt)
                ctrlPnt.isFixedPos = this.isFixedPos;
                ctrlPnt.type = CtrlType.SIZE_CTRL;
                ctrlPnt.name = `pCtrlp${i}`
                ctrlPnt.on(Events.MOUSE_DOWN, () => {
                    const { x, y } = this.getVctor();
                    vctX = x;
                    vctY = y;
                })
                // ctrlPnt.on(Events.MOUSE_ENTER, ()=>{
                //     console.log(111);
                // })
                ctrlPnt.on(Events.DRAG, () => {  // 控制点一律使用DRAG事件,否则会意外旋转情况
                    this.computeNewSize(ctrlPnt, { x: vctX, y: vctY })
                })
                ctrlPnt.on(Events.MOUSE_UP, () => {  // 控制点一律使用DRAG事件,否则会意外旋转情况
                    this.resize()
                })
            })
        }
        // 旋转点
        if (bindF.ctrlTypes.includes(CtrlType.ANGLE_CTRL)) {
            const { x, y } = this.getRotatePnt();
            const rCtrlP = new Pnt(x, y, Bbox.ctrlPSize, Bbox.ctrlPSize);
            rCtrlP.isFixedPos = this.isFixedPos;
            rCtrlP.isBasic = false;
            this.addChild(rCtrlP)
            rCtrlP.type = CtrlType.ANGLE_CTRL;
            rCtrlP.name = 'rCtrlp'
            let lastAngle = 0;
            let bboxPos = this.getCenterPos(); // bbox的中心点
            const vct1: IVctor = [0, -100];
            rCtrlP.on(Events.MOUSE_DOWN, () => {
                bboxPos = this.getCenterPos(); // bbox的中心点
                const bctrlPos = this.getCenterPos(rCtrlP.pointArr); // 旋转控制点的中心点
                const vct2 = Utils.getVector(bboxPos, bctrlPos);
                lastAngle = Utils.getRotateAng(vct1, vct2);
            })
            rCtrlP.on(Events.DRAG, () => {
                const bctrlPos = this.getCenterPos(rCtrlP.pointArr); // 旋转控制点的中心点
                const vct2 = Utils.getVector(bboxPos, bctrlPos);
                let angle = Utils.getRotateAng(vct1, vct2);
                const offsetAngle = angle - lastAngle;
                this.rotate(offsetAngle);
                if (Bbox.angleAbsorb) { // 角度吸附
                    let absorbAngle = 0
                    if (this.angle <= 2 && !absorbAngle) {
                        absorbAngle = 0 - this.angle
                    }
                    if (this.angle >= 43 && this.angle <= 47 && !absorbAngle) {
                        absorbAngle = 45 - this.angle
                    }
                    if (this.angle >= 88 && this.angle <= 92 && !absorbAngle) {
                        absorbAngle = 90 - this.angle
                    }
                    if (this.angle >= 133 && this.angle <= 137 && !absorbAngle) {
                        absorbAngle = 135 - this.angle
                    }
                    if (this.angle >= 178 && this.angle <= 182 && !absorbAngle) {
                        absorbAngle = 180 - this.angle
                    }
                    if (this.angle >= 223 && this.angle <= 227 && !absorbAngle) {
                        absorbAngle = 225 - this.angle
                    }
                    if (this.angle >= 268 && this.angle <= 272 && !absorbAngle) {
                        absorbAngle = 270 - this.angle
                    }
                    if (this.angle >= 313 && this.angle <= 317 && !absorbAngle) {
                        absorbAngle = 315 - this.angle
                    }
                    if (this.angle >= 358 && !absorbAngle) {
                        absorbAngle = 360 - this.angle
                    }
                    this.rotate(absorbAngle);
                    angle += absorbAngle;
                }
                lastAngle = angle;
            })
            rCtrlP.on(Events.MOUSE_UP, () => {  // 控制点一律使用DRAG事件,否则会意外旋转情况
                this.resize()
            })
        }

        if (width) { // 宽度为0不要生成控制点,不合理
            if (bindF.ctrlTypes.includes(CtrlType.WIDTH_CTRL)) {
                // 左边
                {
                    const { x, y } = this.getLeftMidPnt();
                    const bCtrlP2 = new Pnt(x, y, Bbox.ctrlPSize, Bbox.ctrlPSize);
                    bCtrlP2.isFixedPos = this.isFixedPos;
                    bCtrlP2.isBasic = false;
                    this.addChild(bCtrlP2)
                    bCtrlP2.type = CtrlType.WIDTH_CTRL;
                    bCtrlP2.name = `pCtrlp${4}`
                    bCtrlP2.on(Events.MOUSE_DOWN, () => {
                        const { x, y } = this.getVctor();
                        vctX = x;
                        vctY = y;
                    })
                    bCtrlP2.on(Events.DRAG, () => {
                        const ctrlPos = bCtrlP2.getCenterPos();  // 当前控制点的中心点
                        const len = Utils.getLenOfTwoPnts(ctrlPos, this.pointArr[1]);
                        const angle = Utils.getAngleOfTwoPnts(ctrlPos, this.pointArr[1]);
                        let { x: dx, y: dy } = Utils.getDevideLenOfAngle(len, angle - this.angle);
                        if (lastDx) this.computeNewPosition(this, dx - lastDx, AlignType.LEFT, bCtrlP2, { x: vctX, y: vctY })
                        lastDx = dx;
                    })
                    bCtrlP2.on(Events.MOUSE_UP, () => {
                        this.resize()
                    })
                }
                // 右边
                {
                    const { x, y } = this.getRightMidPnt();
                    const bCtrlP3 = new Pnt(x, y, Bbox.ctrlPSize, Bbox.ctrlPSize);
                    bCtrlP3.isFixedPos = this.isFixedPos;
                    bCtrlP3.isBasic = false;
                    this.addChild(bCtrlP3)
                    bCtrlP3.type = CtrlType.WIDTH_CTRL;
                    bCtrlP3.name = `pCtrlp${5}`;
                    bCtrlP3.on(Events.MOUSE_DOWN, () => {
                        const { x, y } = this.getVctor();
                        vctX = x;
                        vctY = y;
                    })
                    bCtrlP3.on(Events.DRAG, () => {
                        const ctrlPos = bCtrlP3.getCenterPos();  // 当前控制点的中心点
                        const len = Utils.getLenOfTwoPnts(ctrlPos, this.pointArr[0]);
                        const angle = Utils.getAngleOfTwoPnts(ctrlPos, this.pointArr[0]);
                        let { x: dx, y: dy } = Utils.getDevideLenOfAngle(len, angle - this.angle);
                        dx = -dx;
                        if (lastDx) this.computeNewPosition(this, dx - lastDx, AlignType.RIGHT, bCtrlP3, { x: vctX, y: vctY })
                        lastDx = dx;
                    })
                    bCtrlP3.on(Events.MOUSE_UP, () => {
                        this.resize()
                    })
                }
            }
        }
        if (height) { // 高度为0不要生成控制点,不合理
            if (bindF.ctrlTypes.includes(CtrlType.HEIGHT_CTRL)) {
                // 上边
                {
                    const { x, y } = this.getTopMidPnt();
                    const bCtrlP4 = new Pnt(x, y, Bbox.ctrlPSize, Bbox.ctrlPSize);
                    bCtrlP4.isFixedPos = this.isFixedPos;
                    bCtrlP4.isBasic = false;
                    this.addChild(bCtrlP4)
                    bCtrlP4.type = CtrlType.HEIGHT_CTRL;
                    bCtrlP4.name = `pCtrlp${6}`
                    bCtrlP4.on(Events.MOUSE_DOWN, () => {
                        const { x, y } = this.getVctor();
                        vctX = x;
                        vctY = y;
                    })
                    bCtrlP4.on(Events.DRAG, () => {
                        const ctrlPos = bCtrlP4.getCenterPos();  // 当前控制点的中心点
                        const len = Utils.getLenOfTwoPnts(ctrlPos, this.pointArr[2]);
                        const angle = Utils.getAngleOfTwoPnts(ctrlPos, this.pointArr[2]);
                        let { x: dx, y: dy } = Utils.getDevideLenOfAngle(len, angle - this.angle);
                        // if (bindF instanceof Rect && bindF.minTransHeight && dy < bindF.minTransHeight) return;
                        if (lastDy) this.computeNewPosition(this, dy - lastDy, AlignType.TOP, bCtrlP4, { x: vctX, y: vctY })
                        lastDy = dy;
                    })
                    bCtrlP4.on(Events.MOUSE_UP, () => {
                        this.resize()
                    })
                }
                {
                    // 下边
                    const { x, y } = this.getBottomMidPnt();
                    const bCtrlP5 = new Pnt(x, y, Bbox.ctrlPSize, Bbox.ctrlPSize);
                    bCtrlP5.isFixedPos = this.isFixedPos;
                    bCtrlP5.isBasic = false;
                    this.addChild(bCtrlP5)
                    bCtrlP5.type = CtrlType.HEIGHT_CTRL;
                    bCtrlP5.name = `pCtrlp${7}`
                    bCtrlP5.on(Events.MOUSE_DOWN, () => {
                        const { x, y } = this.getVctor();
                        vctX = x;
                        vctY = y;
                    })
                    bCtrlP5.on(Events.DRAG, () => {
                        const ctrlPos = bCtrlP5.getCenterPos();  // 当前控制点的中心点
                        const len = Utils.getLenOfTwoPnts(ctrlPos, this.pointArr[1]);
                        const angle = Utils.getAngleOfTwoPnts(ctrlPos, this.pointArr[1]);
                        let { x: dx, y: dy } = Utils.getDevideLenOfAngle(len, angle - this.angle);
                        dy = -dy;
                        // if (bindF instanceof Rect && bindF.minTransHeight && dy < bindF.minTransHeight) return;
                        if (lastDy) this.computeNewPosition(this, dy - lastDy, AlignType.BOTTOM, bCtrlP5, { x: vctX, y: vctY })
                        lastDy = dy;
                    })
                    bCtrlP5.on(Events.MOUSE_UP, () => {
                        this.resize()
                    })
                }
            }
        }

        // 线的点坐标控制点
        if (bindF.ctrlTypes.includes(CtrlType.PNT_CTRL)) {
            const originPnts = bindF.pointArr.filter(f => !f.generated);
            originPnts.forEach((curP, i) => {
                const { x, y } = curP;
                const ctrlPnt = new Pnt(x, y, Bbox.ctrlPSize, Bbox.ctrlPSize)
                ctrlPnt.isFixedPos = this.isFixedPos;
                ctrlPnt.isBasic = false;
                this.addChild(ctrlPnt)
                ctrlPnt.fillStyle = '#CDD2DB';
                ctrlPnt.strokeStyle = '#2c3e50';
                ctrlPnt.on(Events.DRAG, () => {
                    const originPnts2 = bindF.pointArr.filter(f => !f.generated);
                    if (originPnts2[i]) {
                        const center = this.getCenterPos(ctrlPnt.pointArr)
                        originPnts2[i].x = center.x
                        originPnts2[i].y = center.y
                        this.resize(bindF);
                        if (bindF instanceof Line && bindF.getGeneratePointArrFn) {
                            bindF.pointArr = bindF.getGeneratePointArrFn(originPnts2)
                        }
                    }
                    bindF.dispatch(new CustomEvent(Events.RESIZE, { detail: { bindF } }))

                })
                ctrlPnt.on(Events.MOUSE_UP, () => {
                    let { width, height } = this.getRectInfo();
                    this.setPnt2BboxPer(this, width, height)
                    bindF.dispatch(new CustomEvent(Events.RESIZE, { detail: { bindF } }))
                })
            })
        }
        if (bindF.ctrlTypes.includes(CtrlType.BEZIER_CTRL)) {  // 贝塞尔曲线控制点
            bindF.bezierCtrlPnts.forEach((ctrlp, i) => {
                if (ctrlp) {
                    const { x, y } = ctrlp;
                    const bezierP = new Pnt(x, y, Bbox.ctrlPSize, Bbox.ctrlPSize)
                    bezierP.isFixedPos = this.isFixedPos;
                    bezierP.isBasic = false;
                    bezierP.name = 'bezierCtrlP'
                    this.addChild(bezierP)
                    bezierP.fillStyle = '#F89696';
                    bezierP.strokeStyle = '#000';
                    bezierP.on(Events.DRAG, () => {
                        bindF.bezierCtrlPnts[i] = bezierP.pointArr[0];
                        const originPnts = bindF.pointArr.filter(f => !f.generated);
                        if (bindF.getGeneratePointArrFn) {
                            bindF.pointArr = bindF.getGeneratePointArrFn(originPnts)
                        }
                        this.resize(bindF);
                        bindF.dispatch(new CustomEvent(Events.RESIZE, { detail: { bindF } }))

                    })
                    bezierP.on(Events.MOUSE_UP, () => {
                        let { width, height } = this.getRectInfo();
                        this.setPnt2BboxPer(this, width, height)
                        bindF.dispatch(new CustomEvent(Events.RESIZE, { detail: { bindF } }))
                    })
                }
            })
        }

        // if (bindF.ctrlTypes.includes(CtrlType.RADIUS_CTRL)) {  // 圆角控制点
        //     const { x, y } = this.getRadiusPnt();
        //     const rCtrlP = new Pnt(x, y, Bbox.ctrlPSize, Bbox.ctrlPSize);
        // rCtrlP.isFixedPos = this.isFixedPos;
        //     rCtrlP.isBasic = false;
        //     this.addChild(rCtrlP)
        //     rCtrlP.type = CtrlType.ANGLE_CTRL;
        //     rCtrlP.name = 'rdCtrlp'
        //     let lastAngle = 0;
        //     let bboxPos = this.getCenterPos(); // bbox的中心点
        //     const vct1: IVctor = [0, -100];
        //     rCtrlP.on(Events.MOUSE_DOWN, () => {
        //         bboxPos = this.getCenterPos(); // bbox的中心点
        //         const bctrlPos = this.getCenterPos(rCtrlP.pointArr); // 旋转控制点的中心点
        //         const vct2 = Utils.getVector(bboxPos, bctrlPos);
        //         lastAngle = Utils.getRotateAng(vct1, vct2);
        //     })
        //     rCtrlP.on(Events.DRAG, () => {
        //         const bctrlPos = this.getCenterPos(rCtrlP.pointArr); // 旋转控制点的中心点
        //         const vct2 = Utils.getVector(bboxPos, bctrlPos);
        //         let angle = Utils.getRotateAng(vct1, vct2);
        //         const offsetAngle = angle - lastAngle;
        //         this.rotate(offsetAngle);
        //     })
        //     rCtrlP.on(Events.MOUSE_UP, () => {  // 控制点一律使用DRAG事件,否则会意外旋转情况
        //         this.resize()
        //     })
        // }
    }

    computeNewSize(ctrlPnt: Pnt, vcts: { x: IVctor, y: IVctor }) {
        let ctrlPos = ctrlPnt.pointArr[0];  // 当前控制点的中心点
        switch (ctrlPnt.name) {
            case 'pCtrlp0':  // 左上角
                {
                    if (Bbox.keepRatio) {  // 等比缩放下, 强行设置控制点在0,2对角线上
                        const pInVct = Utils.getPntInVct(this.pointArr[2], this.hypotenuseVct1, 10);
                        ctrlPos = Utils.getProjectionPoint(ctrlPos, pInVct, this.pointArr[2])
                        ctrlPnt.pointArr = [ctrlPos];
                    }
                    const len = Utils.getLenOfTwoPnts(ctrlPos, this.pointArr[2]);
                    const angle = Utils.getAngleOfTwoPnts(ctrlPos, this.pointArr[2]);
                    let { x: dx, y: dy } = Utils.getDevideLenOfAngle(len, angle - this.angle);
                    if (lastDx) this.computeNewPosition(this, dx - lastDx, AlignType.LEFT, ctrlPnt, vcts)
                    if (lastDy) this.computeNewPosition(this, dy - lastDy, AlignType.TOP, ctrlPnt, vcts)
                    lastDx = dx; lastDy = dy;
                }
                break;
            case 'pCtrlp1':  // 右上角
                {
                    if (Bbox.keepRatio) { // 等比缩放下, 强行设置控制点在1,3对角线上
                        const pInVct = Utils.getPntInVct(this.pointArr[3], this.hypotenuseVct2, 10);
                        ctrlPos = Utils.getProjectionPoint(ctrlPos, pInVct, this.pointArr[3])
                        ctrlPnt.pointArr = [ctrlPos];
                    }
                    const len = Utils.getLenOfTwoPnts(ctrlPos, this.pointArr[3]);
                    const angle = Utils.getAngleOfTwoPnts(ctrlPos, this.pointArr[3]);
                    let { x: dx, y: dy } = Utils.getDevideLenOfAngle(len, angle - this.angle)
                    dx = -dx
                    if (lastDx) this.computeNewPosition(this, dx - lastDx, AlignType.RIGHT, ctrlPnt, vcts)
                    if (lastDy) this.computeNewPosition(this, dy - lastDy, AlignType.TOP, ctrlPnt, vcts)
                    lastDx = dx; lastDy = dy;
                }
                break;
            case 'pCtrlp2':  // 右下角
                {
                    if (Bbox.keepRatio) { // 等比缩放下, 强行设置控制点在0,2对角线上
                        const pInVct = Utils.getPntInVct(this.pointArr[2], this.hypotenuseVct1, 10);
                        ctrlPos = Utils.getProjectionPoint(ctrlPos, pInVct, this.pointArr[2])
                        ctrlPnt.pointArr = [ctrlPos];
                    }
                    const len = Utils.getLenOfTwoPnts(ctrlPos, this.pointArr[0]);
                    const angle = Utils.getAngleOfTwoPnts(ctrlPos, this.pointArr[0]);
                    let { x: dx, y: dy } = Utils.getDevideLenOfAngle(len, angle - this.angle)
                    dx = -dx
                    dy = -dy
                    if (lastDx) this.computeNewPosition(this, dx - lastDx, AlignType.RIGHT, ctrlPnt, vcts)
                    if (lastDy) this.computeNewPosition(this, dy - lastDy, AlignType.BOTTOM, ctrlPnt, vcts)
                    lastDx = dx; lastDy = dy;
                }
                break;
            case 'pCtrlp3':  // 左下角
                {
                    if (Bbox.keepRatio) { // 等比缩放下, 强行设置控制点在1,3对角线上
                        const pInVct = Utils.getPntInVct(this.pointArr[3], this.hypotenuseVct2, 10);
                        ctrlPos = Utils.getProjectionPoint(ctrlPos, pInVct, this.pointArr[3])
                        ctrlPnt.pointArr = [ctrlPos];
                    }
                    const len = Utils.getLenOfTwoPnts(ctrlPos, this.pointArr[1]);
                    const angle = Utils.getAngleOfTwoPnts(ctrlPos, this.pointArr[1]);
                    let { x: dx, y: dy } = Utils.getDevideLenOfAngle(len, angle - this.angle)
                    dy = -dy
                    if (lastDx) this.computeNewPosition(this, dx - lastDx, AlignType.LEFT, ctrlPnt, vcts)
                    if (lastDy) this.computeNewPosition(this, dy - lastDy, AlignType.BOTTOM, ctrlPnt, vcts)
                    lastDx = dx; lastDy = dy;
                }
                break;
            default:
                break;
        }
    }

    getBboxWrapPnts(feature: Feature) {  // 获取bbox矩形的四个点坐标
        const zeroPntArr = Utils.getPointArr(feature.pointArr, -feature.angle);
        const center = Utils.getCenterPos(zeroPntArr);
        const rectPntArr = Utils.getBboxPoints(zeroPntArr);
        const width = Utils.getLenOfTwoPnts(rectPntArr[0], rectPntArr[1]) + this.margin
        const height = Utils.getLenOfTwoPnts(rectPntArr[1], rectPntArr[2]) + this.margin
        const bboxRectPointArr = Utils.getRectPoints(center, { width, height })
        const rPointArr = Utils.getPointArr(bboxRectPointArr, feature.angle, Utils.getCenterPos(feature.pointArr))
        return rPointArr
    }

    //重置bbox的大小和更新控制点的位置
    resize(bindF: Feature = this.bindF) {
        this.pointArr = this.getBboxWrapPnts(bindF);
        this.hypotenuseVct1 = Utils.getVector(this.pointArr[0], this.pointArr[2]);
        this.hypotenuseVct2 = Utils.getVector(this.pointArr[1], this.pointArr[3]);
        const pCtrlPnts = this.children.filter(f => f.name.indexOf('pCtrlp') > -1 || f.name == 'rCtrlp');
        pCtrlPnts.forEach((ctrlP, i) => {
            switch (ctrlP.name) {
                case 'pCtrlp0': { // 左上
                    const { x, y } = this.getLeftTopPnt();
                    ctrlP.pointArr[0].x = x
                    ctrlP.pointArr[0].y = y
                    break;
                }
                case 'pCtrlp1': {  // 右上
                    const { x, y } = this.getRightTopPnt();
                    ctrlP.pointArr[0].x = x
                    ctrlP.pointArr[0].y = y
                    break;
                }
                case 'pCtrlp2': {  // 右下
                    const { x, y } = this.getRightBottomPnt();
                    ctrlP.pointArr[0].x = x
                    ctrlP.pointArr[0].y = y
                    break;
                }
                case 'pCtrlp3': { // 左下
                    const { x, y } = this.getLeftBottomPnt();
                    ctrlP.pointArr[0].x = x
                    ctrlP.pointArr[0].y = y
                    break;
                }
                case 'pCtrlp4': {   // 左中
                    ctrlP.pointArr[0] = this.getLeftMidPnt();
                    break;
                }
                case 'pCtrlp5': {  // 右中
                    ctrlP.pointArr[0] = this.getRightMidPnt();
                    break;
                }
                case 'pCtrlp6': {  // 上中
                    ctrlP.pointArr[0] = this.getTopMidPnt();
                    break;
                }
                case 'pCtrlp7': {  // 下中
                    ctrlP.pointArr[0] = this.getBottomMidPnt();
                    break;
                }
                case 'rCtrlp':
                    ctrlP.pointArr[0] = this.getRotatePnt();
                    break;
                default:
                    break;
            }
        })
        const { width, height } = this.getRectInfo();
        this.setPnt2BboxPer(this, width, height);
        lastDx = 0; lastDy = 0;
    }

    // 四个控制点位置
    getLeftTopPnt() {
        return { ...this.pointArr[0] };
    }
    getRightTopPnt() {
        return { ...this.pointArr[1] };
    }
    getRightBottomPnt() {
        return { ...this.pointArr[2] };
    }
    getLeftBottomPnt() {
        return { ...this.pointArr[3] };
    }

    // 四个边中点位置
    getLeftMidPnt() {
        return { ...Utils.getMidOfTwoPnts(this.pointArr[0], this.pointArr[3]) };
    }
    getRightMidPnt() {
        return { ...Utils.getMidOfTwoPnts(this.pointArr[1], this.pointArr[2]) };
    }
    getTopMidPnt() {
        return { ...Utils.getMidOfTwoPnts(this.pointArr[0], this.pointArr[1]) };
    }
    getBottomMidPnt() {
        return { ...Utils.getMidOfTwoPnts(this.pointArr[2], this.pointArr[3]) };
    }

    getRotatePnt() {
        const vct = Utils.getVector(this.pointArr[0], this.pointArr[3]);   // 控制点1,2的向量
        const midPnt = Utils.getMidOfTwoPnts(this.pointArr[0], this.pointArr[1]);
        return { ...Utils.getPntInVct(midPnt, vct, -20) }
    }

    // getRadiusPnt() {
    //     const vct = Utils.getVector(this.pointArr[0], this.pointArr[3]);   // 控制点1,2的向量
    //     const midPnt = Utils.getMidOfTwoPnts(this.pointArr[0], this.pointArr[1]);
    //     return { ...Utils.getPntInVct(midPnt, vct, -transformer.getPixelSize(3)) }
    // }

    destroy() {
        this.bindF.bounded = false;
        super.destroy();
    }
}
