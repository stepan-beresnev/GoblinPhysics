/**
 * Provides the classes and algorithms for running GJK+EPA based collision detection
 *
 * @class GjkEpa2
 * @static
 */
Goblin.GjkEpa2 = {
	margins: 0.03,
	result: null,

    max_iterations: 20,
    epa_condition: 0.001,

    /**
     * Holds a point on the edge of a Minkowski difference along with that point's witnesses and the direction used to find the point
     *
     * @class SupportPoint
     * @param witness_a {vec3} Point in first object used to find the supporting point
     * @param witness_b {vec3} Point in the second object ued to find th supporting point
     * @param point {vec3} The support point on the edge of the Minkowski difference
     * @constructor
     */
    SupportPoint: function( witness_a, witness_b, point ) {
        this.witness_a = witness_a;
        this.witness_b = witness_b;
        this.point = point;
    },

    /**
     * Finds the extant point on the edge of the Minkowski difference for `object_a` - `object_b` in `direction`
     *
     * @method findSupportPoint
     * @param object_a {Goblin.RigidBody} First object in the search
     * @param object_b {Goblin.RigidBody} Second object in the search
     * @param direction {vec3} Direction to find the extant point in
     * @param gjk_point {Goblin.GjkEpa.SupportPoint} `SupportPoint` class to store the resulting point & witnesses in
     */
    findSupportPoint: (function(){
        var temp = new Goblin.Vector3();
        return function( object_a, object_b, direction, support_point ) {
            // Find witnesses from the objects
            object_a.findSupportPoint( direction, support_point.witness_a );
            temp.scaleVector( direction, -1 );
            object_b.findSupportPoint( temp, support_point.witness_b );

            // Find the CSO support point
            support_point.point.subtractVectors( support_point.witness_a, support_point.witness_b );
        };
    })(),

	testCollision: function( object_a, object_b ) {
		var simplex = Goblin.GjkEpa2.GJK( object_a, object_b );
		if ( Goblin.GjkEpa2.result != null ) {
			return Goblin.GjkEpa2.result;
		} else if ( simplex != null ) {
			return Goblin.GjkEpa2.EPA( simplex );
		}
	},

    /**
     * Perform GJK algorithm against two objects. Returns a ContactDetails object if there is a collision, else null
     *
     * @method GJK
     * @param object_a {Goblin.RigidBody}
     * @param object_b {Goblin.RigidBody}
     * @return {Goblin.ContactDetails|Boolean} Returns `null` if no collision, else a `ContactDetails` object
     */
	GJK: (function(){
        return function( object_a, object_b ) {
            var simplex = new Goblin.GjkEpa2.Simplex( object_a, object_b ),
                last_point;

			Goblin.GjkEpa2.result = null;

            while ( ( last_point = simplex.addPoint() ) ){}

            // If last_point is false then there is no collision
            if ( last_point === false ) {
				Goblin.GjkEpa2.freeSimplex( simplex );
                return null;
            }

            return simplex;
        };
    })(),

	freeSimplex: function( simplex ) {
		// Free the support points used by this simplex
		for ( var i = 0, points_length = simplex.points.length; i < points_length; i++ ) {
			Goblin.ObjectPool.freeObject( 'GJK2SupportPoint', simplex.points[i] );
		}
	},

	freePolyhedron: function( polyhedron ) {
		// Free the support points used by the polyhedron (includes the points from the simplex used to create the polyhedron
		var pool = Goblin.ObjectPool.pools['GJK2SupportPoint'];

		for ( var i = 0, faces_length = polyhedron.faces.length; i < faces_length; i++ ) {
			// The indexOf checking is required because vertices are shared between faces
			if ( pool.indexOf( polyhedron.faces[i].a ) === -1 ) {
				Goblin.ObjectPool.freeObject( 'GJK2SupportPoint', polyhedron.faces[i].a );
			}
			if ( pool.indexOf( polyhedron.faces[i].b ) === -1 ) {
				Goblin.ObjectPool.freeObject( 'GJK2SupportPoint', polyhedron.faces[i].b );
			}
			if ( pool.indexOf( polyhedron.faces[i].c ) === -1 ) {
				Goblin.ObjectPool.freeObject( 'GJK2SupportPoint', polyhedron.faces[i].c );
			}
		}
	},

    /**
     * Performs the Expanding Polytope Algorithm a GJK simplex
     *
     * @method EPA
     * @param simplex {Goblin.GjkEpa2.Simplex} Simplex generated by the GJK algorithm
     * @return {Goblin.ContactDetails}
     */
    EPA: (function(){
		return function( simplex ) {
            // Time to convert the simplex to real faces
            // @TODO this should be a priority queue where the position in the queue is ordered by distance from face to origin
			var polyhedron = new Goblin.GjkEpa2.Polyhedron( simplex );

			var i = 0;

            // Expand the polyhedron until it doesn't expand any more
			while ( ++i ) {
				polyhedron.findFaceClosestToOrigin();

				// Find a new support point in the direction of the closest point
				if ( polyhedron.closest_face_distance < Goblin.EPSILON ) {
					_tmp_vec3_1.copy( polyhedron.faces[polyhedron.closest_face].normal );
				} else {
					_tmp_vec3_1.copy( polyhedron.closest_point );
				}

				var support_point = Goblin.ObjectPool.getObject( 'GJK2SupportPoint' );
				Goblin.GjkEpa2.findSupportPoint( simplex.object_a, simplex.object_b, _tmp_vec3_1, support_point );

				// Check for terminating condition
                _tmp_vec3_1.subtractVectors( support_point.point, polyhedron.closest_point );
                var gap = _tmp_vec3_1.lengthSquared();

				if ( i === Goblin.GjkEpa2.max_iterations || ( gap < Goblin.GjkEpa2.epa_condition && polyhedron.closest_face_distance > Goblin.EPSILON ) ) {

					// Get a ContactDetails object and fill out its details
					var contact = Goblin.ObjectPool.getObject( 'ContactDetails' );
					contact.object_a = simplex.object_a;
					contact.object_b = simplex.object_b;

					contact.contact_normal.normalizeVector( polyhedron.closest_point );
					if ( contact.contact_normal.lengthSquared() === 0 ) {
						contact.contact_normal.subtractVectors( contact.object_b.position, contact.object_a.position );
					}
					contact.contact_normal.normalize();

					var barycentric = new Goblin.Vector3();
					Goblin.GeometryMethods.findBarycentricCoordinates( polyhedron.closest_point, polyhedron.faces[polyhedron.closest_face].a.point, polyhedron.faces[polyhedron.closest_face].b.point, polyhedron.faces[polyhedron.closest_face].c.point, barycentric );

					if ( isNaN( barycentric.x ) ) {
                        // @TODO: Avoid this degenerate case
						//console.log( 'Point not in triangle' );
						Goblin.GjkEpa2.freePolyhedron( polyhedron );
						return null;
					}

					var confirm = {
						a: new Goblin.Vector3(),
						b: new Goblin.Vector3(),
						c: new Goblin.Vector3()
					};

					// Contact coordinates of object a
					confirm.a.scaleVector( polyhedron.faces[polyhedron.closest_face].a.witness_a, barycentric.x );
					confirm.b.scaleVector( polyhedron.faces[polyhedron.closest_face].b.witness_a, barycentric.y );
					confirm.c.scaleVector( polyhedron.faces[polyhedron.closest_face].c.witness_a, barycentric.z );
					contact.contact_point_in_a.addVectors( confirm.a, confirm.b );
					contact.contact_point_in_a.add( confirm.c );

					// Contact coordinates of object b
					confirm.a.scaleVector( polyhedron.faces[polyhedron.closest_face].a.witness_b, barycentric.x );
					confirm.b.scaleVector( polyhedron.faces[polyhedron.closest_face].b.witness_b, barycentric.y );
					confirm.c.scaleVector( polyhedron.faces[polyhedron.closest_face].c.witness_b, barycentric.z );
					contact.contact_point_in_b.addVectors( confirm.a, confirm.b );
					contact.contact_point_in_b.add( confirm.c );

					// Find actual contact point
					contact.contact_point.addVectors( contact.contact_point_in_a, contact.contact_point_in_b );
					contact.contact_point.scale( 0.5  );

					// Set objects' local points
					contact.object_a.transform_inverse.transformVector3( contact.contact_point_in_a );
					contact.object_b.transform_inverse.transformVector3( contact.contact_point_in_b );

					// Calculate penetration depth
					contact.penetration_depth = polyhedron.closest_point.length() + Goblin.GjkEpa2.margins;

					contact.restitution = ( simplex.object_a.restitution + simplex.object_b.restitution ) / 2;
					contact.friction = ( simplex.object_a.friction + simplex.object_b.friction ) / 2;

					Goblin.GjkEpa2.freePolyhedron( polyhedron );

					return contact;
				}

                polyhedron.addVertex( support_point );
			}

			Goblin.GjkEpa2.freePolyhedron( polyhedron );
            return null;
        };
    })(),

    Face: function( polyhedron, a, b, c ) {
		this.active = true;
		//this.polyhedron = polyhedron;
        this.a = a;
        this.b = b;
        this.c = c;
        this.normal = new Goblin.Vector3();
		this.neighbors = [];

        _tmp_vec3_1.subtractVectors( b.point, a.point );
        _tmp_vec3_2.subtractVectors( c.point, a.point );
        this.normal.crossVectors( _tmp_vec3_1, _tmp_vec3_2 );
        this.normal.normalize();
    }
};

Goblin.GjkEpa2.Polyhedron = function( simplex ) {
	this.closest_face = null;
	this.closest_face_distance = null;
	this.closest_point = new Goblin.Vector3();

	this.faces = [
		//BCD, ACB, CAD, DAB
		new Goblin.GjkEpa2.Face( this, simplex.points[2], simplex.points[1], simplex.points[0] ),
		new Goblin.GjkEpa2.Face( this, simplex.points[3], simplex.points[1], simplex.points[2] ),
		new Goblin.GjkEpa2.Face( this, simplex.points[1], simplex.points[3], simplex.points[0] ),
		new Goblin.GjkEpa2.Face( this, simplex.points[0], simplex.points[3], simplex.points[2] )
	];

	this.faces[0].neighbors.push( this.faces[1], this.faces[2], this.faces[3] );
	this.faces[1].neighbors.push( this.faces[2], this.faces[0], this.faces[3] );
	this.faces[2].neighbors.push( this.faces[1], this.faces[3], this.faces[0] );
	this.faces[3].neighbors.push( this.faces[2], this.faces[1], this.faces[0] );
};
Goblin.GjkEpa2.Polyhedron.prototype = {
    addVertex: function( vertex )
    {
        var edges = [], faces = [], i, j, a, b, last_b;
        this.faces[this.closest_face].silhouette( vertex, edges );

        // Re-order the edges if needed
        for ( i = 0; i < edges.length - 5; i += 5 ) {
            a = edges[i+3];
            b = edges[i+4];

            // Ensure this edge really should be the next one
            if ( i !== 0 && last_b !== a ) {
                // It shouldn't
                for ( j = i + 5; j < edges.length; j += 5 ) {
                    if ( edges[j+3] === last_b ) {
                        // Found it
                        var tmp = edges.slice( i, i + 5 );
                        edges[i] = edges[j];
                        edges[i+1] = edges[j+1];
                        edges[i+2] = edges[j+2];
                        edges[i+3] = edges[j+3];
                        edges[i+4] = edges[j+4];
                        edges[j] = tmp[0];
                        edges[j+1] = tmp[1];
                        edges[j+2] = tmp[2];
                        edges[j+3] = tmp[3];
                        edges[j+4] = tmp[4];

                        a = edges[i+3];
                        b = edges[i+4];
                        break;
                    }
                }
            }
            last_b = b;
        }

        for ( i = 0; i < edges.length; i += 5 ) {
            var neighbor = edges[i];
            a = edges[i+3];
            b = edges[i+4];

            var face = new Goblin.GjkEpa2.Face( this, b, vertex, a );
            face.neighbors[2] = edges[i];
            faces.push( face );

            neighbor.neighbors[neighbor.neighbors.indexOf( edges[i+2] )] = face;
        }

        for ( i = 0; i < faces.length; i++ ) {
            faces[i].neighbors[0] = faces[ i + 1 === faces.length ? 0 : i + 1 ];
            faces[i].neighbors[1] = faces[ i - 1 < 0 ? faces.length - 1 : i - 1 ];
        }

		Array.prototype.push.apply( this.faces, faces );

        return edges;
    },

	findFaceClosestToOrigin: (function(){
		var origin = new Goblin.Vector3(),
			point = new Goblin.Vector3();

		return function() {
			this.closest_face_distance = Infinity;

			var distance, i;

			for ( i = 0; i < this.faces.length; i++ ) {
				if ( this.faces[i].active === false ) {
					continue;
				}

				Goblin.GeometryMethods.findClosestPointInTriangle( origin, this.faces[i].a.point, this.faces[i].b.point, this.faces[i].c.point, point );
				distance = point.lengthSquared();
				if ( distance < this.closest_face_distance ) {
					this.closest_face_distance = distance;
					this.closest_face = i;
					this.closest_point.copy( point );
				}
			}
		};
	})()
};

Goblin.GjkEpa2.Face.prototype = {
	/**
	 * Determines if a vertex is in front of or behind the face
	 *
	 * @method classifyVertex
	 * @param vertex {vec3} Vertex to classify
	 * @return {Number} If greater than 0 then `vertex' is in front of the face
	 */
	classifyVertex: function( vertex ) {
		var w = this.normal.dot( this.a.point );
		return this.normal.dot( vertex.point ) - w;
	},

	silhouette: function( point, edges, source ) {
        if ( this.active === false ) {
            return;
        }

        if ( this.classifyVertex( point ) > 0 ) {
			// This face is visible from `point`. Deactivate this face and alert the neighbors
			this.active = false;

			this.neighbors[0].silhouette( point, edges, this );
			this.neighbors[1].silhouette( point, edges, this );
            this.neighbors[2].silhouette( point, edges, this );
		} else if ( source ) {
			// This face is a neighbor to a now-silhouetted face, determine which neighbor and replace it
			var neighbor_idx = this.neighbors.indexOf( source ),
                a, b;
            if ( neighbor_idx === 0 ) {
                a = this.a;
                b = this.b;
            } else if ( neighbor_idx === 1 ) {
                a = this.b;
                b = this.c;
            } else {
                a = this.c;
                b = this.a;
            }
			edges.push( this, neighbor_idx, source, b, a );
		}
	}
};

(function(){
    var origin = new Goblin.Vector3(),
		ao = new Goblin.Vector3(),
        ab = new Goblin.Vector3(),
        ac = new Goblin.Vector3(),
        ad = new Goblin.Vector3();

    Goblin.GjkEpa2.Simplex = function( object_a, object_b ) {
        this.object_a = object_a;
        this.object_b = object_b;
        this.points = [];
        this.iterations = 0;
        this.next_direction = new Goblin.Vector3();
        this.updateDirection();
    };
    Goblin.GjkEpa2.Simplex.prototype = {
        addPoint: function() {
            if ( ++this.iterations === Goblin.GjkEpa2.max_iterations ) {
                return false;
            }

            var support_point = Goblin.ObjectPool.getObject( 'GJK2SupportPoint' );
            Goblin.GjkEpa2.findSupportPoint( this.object_a, this.object_b, this.next_direction, support_point );
            this.points.push( support_point );

			if ( support_point.point.dot( this.next_direction ) < 0 && this.points.length > 1 ) {
				// Check the margins first
				// @TODO this can be expanded to support 1-simplex (2 points)
				if ( this.points.length >= 3 ) {
					Goblin.GeometryMethods.findClosestPointInTriangle(
						origin,
						this.points[0].point,
						this.points[1].point,
						this.points[2].point,
						_tmp_vec3_1
					);
					var distanceSquared = _tmp_vec3_1.lengthSquared();

					if ( distanceSquared <= Goblin.GjkEpa2.margins * Goblin.GjkEpa2.margins ) {
						// Get a ContactDetails object and fill out its details
						var contact = Goblin.ObjectPool.getObject( 'ContactDetails' );
						contact.object_a = this.object_a;
						contact.object_b = this.object_b;

						contact.contact_normal.normalizeVector( _tmp_vec3_1 );
						if ( contact.contact_normal.lengthSquared() === 0 ) {
							contact.contact_normal.subtractVectors( contact.object_b.position, contact.object_a.position );
						}
						contact.contact_normal.normalize();
						contact.contact_normal.scale( -1 );

						contact.penetration_depth = Goblin.GjkEpa2.margins - Math.sqrt( distanceSquared );

						var confirm = {
							a: new Goblin.Vector3(),
							b: new Goblin.Vector3(),
							c: new Goblin.Vector3()
						};

						var barycentric = new Goblin.Vector3();
						Goblin.GeometryMethods.findBarycentricCoordinates( _tmp_vec3_1, this.points[0].point, this.points[1].point, this.points[2].point, barycentric );

						if ( isNaN( barycentric.x ) ) {
							//return false;
							debugger;
						}

						// Contact coordinates of object a
						confirm.a.scaleVector( this.points[0].witness_a, barycentric.x );
						confirm.b.scaleVector( this.points[1].witness_a, barycentric.y );
						confirm.c.scaleVector( this.points[2].witness_a, barycentric.z );
						contact.contact_point_in_a.addVectors( confirm.a, confirm.b );
						contact.contact_point_in_a.add( confirm.c );

						// Contact coordinates of object b
						contact.contact_point_in_b.scaleVector( contact.contact_normal, -contact.penetration_depth );
						contact.contact_point_in_b.add( contact.contact_point_in_a );

						// Find actual contact point
						contact.contact_point.addVectors( contact.contact_point_in_a, contact.contact_point_in_b );
						contact.contact_point.scale( 0.5  );

						// Set objects' local points
						contact.object_a.transform_inverse.transformVector3( contact.contact_point_in_a );
						contact.object_b.transform_inverse.transformVector3( contact.contact_point_in_b );

						contact.restitution = ( this.object_a.restitution + this.object_b.restitution ) / 2;
						contact.friction = ( this.object_a.friction + this.object_b.friction ) / 2;

						//Goblin.GjkEpa2.freePolyhedron( polyhedron );

						Goblin.GjkEpa2.result = contact;
						return null;
					}
				}

				// if the last added point was not past the origin in the direction
				// then the Minkowski difference cannot contain the origin because
				// point added is past the edge of the Minkowski difference
				return false;
			}

            if ( this.updateDirection() === true ) {
                // Found a collision
                return null;
            }

            return support_point;
        },

        findDirectionFromLine: function() {
            ao.scaleVector( this.points[1].point, -1 );
            ab.subtractVectors( this.points[0].point, this.points[1].point );

            if ( ab.dot( ao ) < 0 ) {
                // Origin is on the opposite side of A from B
                this.next_direction.copy( ao );
				Goblin.ObjectPool.freeObject( 'GJK2SupportPoint', this.points[1] );
                this.points.length = 1; // Remove second point
			} else {
                // Origin lies between A and B, move on to a 2-simplex
                this.next_direction.crossVectors( ab, ao );
                this.next_direction.cross( ab );

                // In the case that `ab` and `ao` are parallel vectors, direction becomes a 0-vector
                if (
                    this.next_direction.x === 0 &&
                    this.next_direction.y === 0 &&
                    this.next_direction.z === 0
                ) {
                    ab.normalize();
                    this.next_direction.x = 1 - Math.abs( ab.x );
                    this.next_direction.y = 1 - Math.abs( ab.y );
                    this.next_direction.z = 1 - Math.abs( ab.z );
                }
            }
        },

        findDirectionFromTriangle: function() {
            // Triangle
            var a = this.points[2],
                b = this.points[1],
                c = this.points[0];

            ao.scaleVector( a.point, -1 ); // ao
            ab.subtractVectors( b.point, a.point ); // ab
            ac.subtractVectors( c.point, a.point ); // ac

            // Determine the triangle's normal
            _tmp_vec3_1.crossVectors( ab, ac );

            // Edge cross products
            _tmp_vec3_2.crossVectors( ab, _tmp_vec3_1 );
            _tmp_vec3_3.crossVectors( _tmp_vec3_1, ac );

            if ( _tmp_vec3_3.dot( ao ) >= 0 ) {
                // Origin lies on side of ac opposite the triangle
                if ( ac.dot( ao ) >= 0 ) {
                    // Origin outside of the ac line, so we form a new
                    // 1-simplex (line) with points A and C, leaving B behind
                    this.points.length = 0;
                    this.points.push( c, a );
					Goblin.ObjectPool.freeObject( 'GJK2SupportPoint', b );

                    // New search direction is from ac towards the origin
                    this.next_direction.crossVectors( ac, ao );
                    this.next_direction.cross( ac );
                } else {
                    // *
                    if ( ab.dot( ao ) >= 0 ) {
                        // Origin outside of the ab line, so we form a new
                        // 1-simplex (line) with points A and B, leaving C behind
                        this.points.length = 0;
                        this.points.push( b, a );
						Goblin.ObjectPool.freeObject( 'GJK2SupportPoint', c );

                        // New search direction is from ac towards the origin
                        this.next_direction.crossVectors( ab, ao );
                        this.next_direction.cross( ab );
                    } else {
                        // only A gives us a good reference point, start over with a 0-simplex
                        this.points.length = 0;
                        this.points.push( a );
						Goblin.ObjectPool.freeObject( 'GJK2SupportPoint', b );
						Goblin.ObjectPool.freeObject( 'GJK2SupportPoint', c );
                    }
                    // *
                }

            } else {

                // Origin lies on the triangle side of ac
                if ( _tmp_vec3_2.dot( ao ) >= 0 ) {
                    // Origin lies on side of ab opposite the triangle

                    // *
                    if ( ab.dot( ao ) >= 0 ) {
                        // Origin outside of the ab line, so we form a new
                        // 1-simplex (line) with points A and B, leaving C behind
                        this.points.length = 0;
                        this.points.push( b, a );
						Goblin.ObjectPool.freeObject( 'GJK2SupportPoint', c );

                        // New search direction is from ac towards the origin
                        this.next_direction.crossVectors( ab, ao );
                        this.next_direction.cross( ab );
                    } else {
                        // only A gives us a good reference point, start over with a 0-simplex
                        this.points.length = 0;
                        this.points.push( a );
						Goblin.ObjectPool.freeObject( 'GJK2SupportPoint', b );
						Goblin.ObjectPool.freeObject( 'GJK2SupportPoint', c );
                    }
                    // *

                } else {

                    // Origin lies somewhere in the triangle or above/below it
                    if ( _tmp_vec3_1.dot( ao ) >= 0 ) {
                        // Origin is on the front side of the triangle
                        this.next_direction.copy( _tmp_vec3_1 );
						this.points.length = 0;
						this.points.push( a, b, c );
                    } else {
                        // Origin is on the back side of the triangle
                        this.next_direction.copy( _tmp_vec3_1 );
                        this.next_direction.scale( -1 );
                    }

                }

            }
        },

        getFaceNormal: function( a, b, c, destination ) {
            ab.subtractVectors( b.point, a.point );
            ac.subtractVectors( c.point, a.point );
            destination.crossVectors( ab, ac );
            destination.normalize();
        },

        faceNormalDotOrigin: function( a, b, c ) {
            // Find face normal
            this.getFaceNormal( a, b, c, _tmp_vec3_1 );

            // Find direction of origin from center of face
            _tmp_vec3_2.addVectors( a.point, b.point );
            _tmp_vec3_2.add( c.point );
			_tmp_vec3_2.scale( -3 );
			_tmp_vec3_2.normalize();

            return _tmp_vec3_1.dot( _tmp_vec3_2 );
        },

        findDirectionFromTetrahedron: function() {
            var a = this.points[3],
                b = this.points[2],
                c = this.points[1],
                d = this.points[0];

			// Check each of the four sides to see which one is facing the origin.
			// Then keep the three points for that triangle and use its normal as the search direction
			// The four faces are BCD, ACB, CAD, DAB
			var closest_face = null,
				closest_dot = Goblin.EPSILON,
				face_dot;

			// @TODO we end up calculating the "winning" face normal twice, don't do that

			face_dot = this.faceNormalDotOrigin( b, c, d );
			if ( face_dot > closest_dot ) {
				closest_face = 1;
				closest_dot = face_dot;
			}

			face_dot = this.faceNormalDotOrigin( a, c, b );
			if ( face_dot > closest_dot ) {
				closest_face = 2;
				closest_dot = face_dot;
			}

			face_dot = this.faceNormalDotOrigin( c, a, d );
			if ( face_dot > closest_dot ) {
				closest_face = 3;
				closest_dot = face_dot;
			}

			face_dot = this.faceNormalDotOrigin( d, a, b );
			if ( face_dot > closest_dot ) {
				closest_face = 4;
				closest_dot = face_dot;
			}

			if ( closest_face === null ) {
				// We have a collision, ready for EPA
				return true;
			} else if ( closest_face === 1 ) {
				// BCD
				this.points.length = 0;
				this.points.push( b, c, d );
				this.getFaceNormal( b, c, d, _tmp_vec3_1 );
				this.next_direction.copy( _tmp_vec3_1 );
			} else if ( closest_face === 2 ) {
				// ACB
				this.points.length = 0;
				this.points.push( a, c, b );
				this.getFaceNormal( a, c, b, _tmp_vec3_1 );
				this.next_direction.copy( _tmp_vec3_1 );
			} else if ( closest_face === 3 ) {
				// CAD
				this.points.length = 0;
				this.points.push( c, a, d );
				this.getFaceNormal( c, a, d, _tmp_vec3_1 );
				this.next_direction.copy( _tmp_vec3_1 );
			} else if ( closest_face === 4 ) {
				// DAB
				this.points.length = 0;
				this.points.push( d, a, b );
				this.getFaceNormal( d, a, b, _tmp_vec3_1 );
				this.next_direction.copy( _tmp_vec3_1 );
			}
        },

        containsOrigin: function() {
			var a = this.points[3],
                b = this.points[2],
                c = this.points[1],
                d = this.points[0];

            // Check DCA
            ab.subtractVectors( d.point, a.point );
            ad.subtractVectors( c.point, a.point );
            _tmp_vec3_1.crossVectors( ab, ad );
            if ( _tmp_vec3_1.dot( a.point ) > 0 ) {
                return false;
            }

            // Check CBA
            ab.subtractVectors( c.point, a.point );
            ad.subtractVectors( b.point, a.point );
            _tmp_vec3_1.crossVectors( ab, ad );
            if ( _tmp_vec3_1.dot( a.point ) > 0 ) {
                return false;
            }

            // Check ADB
            ab.subtractVectors( b.point, a.point );
            ad.subtractVectors( d.point, a.point );
            _tmp_vec3_1.crossVectors( ab, ad );
            if ( _tmp_vec3_1.dot( a.point ) > 0 ) {
                return false;
            }

            // Check DCB
            ab.subtractVectors( d.point, c.point );
            ad.subtractVectors( b.point, c.point );
            _tmp_vec3_1.crossVectors( ab, ad );
            if ( _tmp_vec3_1.dot( d.point ) > 0 ) {
                return false;
            }

            return true;
        },

        updateDirection: function() {
            if ( this.points.length === 0 ) {

                this.next_direction.subtractVectors( this.object_b.position, this.object_a.position );

            } else if ( this.points.length === 1 ) {

                this.next_direction.scale( -1 );

            } else if ( this.points.length === 2 ) {

                this.findDirectionFromLine();

            } else if ( this.points.length === 3 ) {

                this.findDirectionFromTriangle();

            } else {

                return this.findDirectionFromTetrahedron();

            }
        }
    };
})();
