// controls implementation from https://github.com/yorb-club/YORB2020
// includes simple collision detection
// just add meshes to layer 3 to have them become collidable!
import * as THREE from "three";
export class FirstPersonControls {
    constructor(scene, camera, renderer) {
        this.scene = scene
        this.camera = camera
        this.renderer = renderer

        this.paused = false
        this.cameraHeight = 5.0
        this.raycaster = new THREE.Raycaster()
        
        this.walkSpeed = 250;
        this.runSpeed = 500;
        this.superSprintSpeed = 1000;
        this.acceleration = 600;
        this.deceleration = 800;
        this.currentSpeed = 0;
        this.isRunning = false;
        this.sprintDuration = 0;
        this.superSprintThreshold = 2.0;

        this.onPointerDownPointerX = 0;
        this.onPointerDownPointerY = 0;
        this.onPointerDownLon = 0;
        this.onPointerDownLat = 0;
        this.isUserInteracting = false;

        this.lon = 180
        this.lat = 0
        this.phi = 0
        this.theta = 0;
        
        this.joystickVector = new THREE.Vector2(0,0);
        
        this.setupControls()
        this.setupCollisionDetection()

        this.velocity.y = 0
        this.gravity = true;
        
        if ('ontouchstart' in window) {
            this.setupJoystick();
        }
    }

    pause() {
        this.paused = true
    }
    resume() {
        this.paused = false
    }

    toggleRun() {
        this.isRunning = !this.isRunning;
    }

    setupJoystick() {
        const options = {
            zone: document.getElementById('joystick-container'),
            mode: 'static',
            position: { left: '50%', top: '50%' },
            color: 'white',
            size: 150
        };

        const manager = nipplejs.create(options);

        manager.on('move', (evt, data) => {
            if (data.angle && data.force > 0.3) {
                const angle = data.angle.radian;
                this.joystickVector.x = Math.cos(angle);
                this.joystickVector.y = Math.sin(angle);
            }
        });

        manager.on('end', () => {
            this.joystickVector.set(0,0);
        });
    }

    setupControls() {
        let jumpSpeed = 30;

        this.moveForward = false;
        this.moveBackward = false;
        this.moveLeft = false;
        this.moveRight = false;
        this.canJump = false;

        this.prevTime = performance.now();
        this.velocity = new THREE.Vector3();
        this.direction = new THREE.Vector3();

        // Desktop Pointer Lock
        const onMouseMove = (event) => {
            if (document.pointerLockElement !== this.renderer.domElement) return;
            this.lon -= event.movementX * 0.3;
            this.lat -= event.movementY * 0.3;
            this.computeCameraOrientation();
        };

        document.addEventListener('pointerlockchange', () => {
            if (document.pointerLockElement === this.renderer.domElement) {
                document.addEventListener('mousemove', onMouseMove);
            } else {
                document.removeEventListener('mousemove', onMouseMove);
            }
        });

        this.renderer.domElement.addEventListener('click', () => {
            this.renderer.domElement.requestPointerLock();
        });

        const joystickZone = document.getElementById('joystick-container');
        
        // Mobile Touch Controls
        this.renderer.domElement.addEventListener('touchstart', (e) => {
            if (joystickZone.contains(e.target)) return;
            
            e.preventDefault();
            if (e.touches.length === 1) {
                this.isUserInteracting = true;
                this.onPointerDownPointerX = e.touches[0].clientX;
                this.onPointerDownPointerY = e.touches[0].clientY;
                this.onPointerDownLon = this.lon;
                this.onPointerDownLat = this.lat;
            }
        }, { passive: false });

        this.renderer.domElement.addEventListener('touchmove', (e) => {
            if (joystickZone.contains(e.target)) return;
            e.preventDefault();
            if (this.isUserInteracting && e.touches.length === 1) {
                this.lon = (this.onPointerDownPointerX - e.touches[0].clientX) * -0.3 + this.onPointerDownLon;
                this.lat = (e.touches[0].clientY - this.onPointerDownPointerY) * -0.3 + this.onPointerDownLat;
                this.computeCameraOrientation();
            }
        }, { passive: false });
        
        this.renderer.domElement.addEventListener('touchend', () => {
            this.isUserInteracting = false;
        });


        // Keyboard movement controls
        document.addEventListener('keydown', (event) => {
            switch (event.code) {
                case 'ArrowUp':
                case 'KeyW': this.moveForward = true; break;
                case 'ArrowLeft':
                case 'KeyA': this.moveLeft = true; break;
                case 'ArrowDown':
                case 'KeyS': this.moveBackward = true; break;
                case 'ArrowRight':
                case 'KeyD': this.moveRight = true; break;
                case 'Space':
                    if (this.canJump) this.velocity.y = jumpSpeed;
                    this.canJump = false;
                    break;
                case 'ShiftLeft':
                case 'ShiftRight':
                    this.isRunning = true;
                    break;
            }
        });

        document.addEventListener('keyup', (event) => {
            switch (event.code) {
                case 'ArrowUp':
                case 'KeyW': this.moveForward = false; break;
                case 'ArrowLeft':
                case 'KeyA': this.moveLeft = false; break;
                case 'ArrowDown':
                case 'KeyS': this.moveBackward = false; break;
                case 'ArrowRight':
                case 'KeyD': this.moveRight = false; break;
                case 'ShiftLeft':
                case 'ShiftRight':
                    this.isRunning = false;
                    break;
            }
        });
    }

    clearControls() {
        this.moveForward = false;
        this.moveBackward = false;
        this.moveLeft = false;
        this.moveRight = false;
        this.canJump = false;
        this.isRunning = false;
        this.velocity.set(0, 0, 0);
        this.joystickVector.set(0,0);
    }

    update() {
        this.detectCollisions()
        this.updateControls()
    }

    getCollidables() {
        return [this.scene];
    }

    updateControls() {
        const time = performance.now();
        const rawDelta = (time - this.prevTime) / 1000;
        const delta = Math.min(rawDelta, 0.1);
        
        this.direction.z = Number(this.moveForward) - Number(this.moveBackward);
        this.direction.x = Number(this.moveRight) - Number(this.moveLeft);
        
        if (this.joystickVector.lengthSq() > 0) {
            this.direction.x = this.joystickVector.x;
            this.direction.z = this.joystickVector.y;
        }

        const isMoving = this.moveForward || this.moveBackward || this.moveLeft || this.moveRight || this.joystickVector.lengthSq() > 0;
        
        if (this.isRunning && isMoving) {
            this.sprintDuration += delta;
        } else {
            this.sprintDuration = 0;
        }

        let targetSpeed;
        if (this.sprintDuration > this.superSprintThreshold) {
            targetSpeed = this.superSprintSpeed;
        } else if (this.isRunning) {
            targetSpeed = this.runSpeed;
        } else {
            targetSpeed = isMoving ? this.walkSpeed : 0;
        }
        
        if (this.currentSpeed < targetSpeed) {
            this.currentSpeed = Math.min(this.currentSpeed + this.acceleration * delta, targetSpeed);
        } else if (this.currentSpeed > targetSpeed) {
            this.currentSpeed = Math.max(this.currentSpeed - this.deceleration * delta, targetSpeed);
        }

        this.velocity.x -= this.velocity.x * 10.0 * delta;
        this.velocity.z -= this.velocity.z * 10.0 * delta;

        if (isMoving) {
            const moveDirection = this.direction.clone().normalize();
            this.velocity.z -= moveDirection.z * this.currentSpeed * delta;
            this.velocity.x -= moveDirection.x * this.currentSpeed * delta;
        }

        if ((this.velocity.x > 0 && !this.obstacles.left) || (this.velocity.x < 0 && !this.obstacles.right)) {
            this.camera.translateX(-this.velocity.x * delta);
        }
        if ((this.velocity.z > 0 && !this.obstacles.backward) || (this.velocity.z < 0 && !this.obstacles.forward)) {
            this.camera.position.add(this.getCameraForwardDirAlongXZPlane().multiplyScalar(-this.velocity.z * delta));
        }

        let origin = this.camera.position.clone();
        this.raycaster.set(origin, new THREE.Vector3(0, -1, 0));
        this.raycaster.layers.set(3);

        const intersectionsDown = this.raycaster.intersectObjects(this.getCollidables(), true);
        const onObject = intersectionsDown.length > 0 && intersectionsDown[0].distance < this.cameraHeight + 0.25;

        if (this.gravity) {
            this.velocity.y -= 9.8 * 8.0 * delta;
        } else {
            this.velocity.y = 0;
        }

        if (onObject === true) {
            this.velocity.y = Math.max(0, this.velocity.y);
            this.canJump = true;
            if (intersectionsDown[0].distance < this.cameraHeight) {
                 this.camera.position.y += (this.cameraHeight - intersectionsDown[0].distance);
            }
        }

        this.camera.position.y += this.velocity.y * delta;

        if (this.camera.position.y < -100) {
            this.camera.position.set(-100, 75, 245);
            this.velocity.y = 0;
        }

        this.prevTime = time;
    }


    getCameraForwardDirAlongXZPlane() {
        let forwardDir = new THREE.Vector3(0, 0, -1)
        forwardDir.applyQuaternion(this.camera.quaternion)
        let forwardAlongXZPlane = new THREE.Vector3(forwardDir.x, 0, forwardDir.z)
        forwardAlongXZPlane.normalize()
        return forwardAlongXZPlane
    }

    setupCollisionDetection() {
        this.obstacles = { forward: false, backward: false, right: false, left: false };
    }

    detectCollisions() {
        this.obstacles = { forward: false, backward: false, right: false, left: false };
        var matrix = new THREE.Matrix4();
        matrix.extractRotation(this.camera.matrix);
        var backwardDir = new THREE.Vector3(0, 0, 1).applyMatrix4(matrix);
        var forwardDir = backwardDir.clone().negate();
        var rightDir = new THREE.Vector3(1, 0, 0).applyMatrix4(matrix);
        var leftDir = rightDir.clone().negate();

        let pt = this.camera.position.clone();

        this.obstacles.forward = this.checkCollisions([pt], forwardDir);
        this.obstacles.backward = this.checkCollisions([pt], backwardDir);
        this.obstacles.left = this.checkCollisions([pt], leftDir);
        this.obstacles.right = this.checkCollisions([pt], rightDir);
    }

    checkCollisions(pts, dir) {
        var detectCollisionDistance = 2.0;
        for (var i = 0; i < pts.length; i++) {
            var pt = pts[i].clone();
            this.raycaster.set(pt, dir);
            this.raycaster.layers.set(3);
            var collisions = this.raycaster.intersectObjects(this.getCollidables(), true);
            if (collisions.length > 0 && collisions[0].distance < detectCollisionDistance) {
                return true;
            }
        }
        return false;
    }

    computeCameraOrientation() {
        this.lat = Math.max(-85, Math.min(85, this.lat));
        const euler = new THREE.Euler(0, 0, 0, 'YXZ');
        euler.x = THREE.MathUtils.degToRad(this.lat);
        // --- SOLUTION: THIS IS THE FINAL, CORRECTED LOGIC ---
        euler.y = THREE.MathUtils.degToRad(this.lon);
        this.camera.quaternion.setFromEuler(euler);
    }
}