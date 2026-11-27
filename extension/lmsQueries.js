/**
 * MindX LMS GraphQL Queries & Mutations (captured from lms-api.mindx.edu.vn)
 */
(() => {
  const LMS_GRAPHQL_QUERIES = {
    GET_CUSTOM_TOKEN_MUTATION: `mutation GetCustomToken{users{getCustomToken{customToken}}}`,

    FIND_INFO_IN_ROLE_BY_ID_MUTATION: `mutation FindInfoInRoleById($payload: FindInfoInRoleByIdCommand!) {
  users {
    findInfoInRoleById(payload: $payload) {
      info
      role
      __typename
    }
    __typename
  }
}`,

    GET_CLASSES_QUERY: `query GetClasses($search: String, $centre: String, $operatorId: String, $operationMethodId: [String], $openStatus: [String], $centres: [String], $courses: [String], $courseLines: [String], $startDateFrom: Date, $startDateTo: Date, $endDateFrom: Date, $endDateTo: Date, $haveSlotFrom: Date, $haveSlotTo: Date, $statusNotEquals: String, $attendanceCheckedExists: Boolean, $status: String, $statusIn: [String], $attendanceStatus: [String], $studentAttendanceStatus: [String], $teacherAttendanceStatus: [String], $pageIndex: Int!, $itemsPerPage: Int!, $orderBy: String, $teacherId: String, $teacherSlot: [String], $teacherMinPassedSessions: Int, $passedSessionIndex: Int, $unpassedSessionIndex: Int, $haveSlotIn: HaveSlotIn, $comments: ClassCommentQuery) {
  classes(payload: {filter_textSearch: $search, centre_equals: $centre, centre_in: $centres, operatorId_eq: $operatorId, operationMethodId_in: $operationMethodId, teacher_equals: $teacherId, teacherSlots: $teacherSlot, teacherMinPassedSessions: $teacherMinPassedSessions, course_in: $courses, courseLine_in: $courseLines, startDate_gt: $startDateFrom, startDate_lt: $startDateTo, endDate_gt: $endDateFrom, endDate_lt: $endDateTo, haveSlot_from: $haveSlotFrom, haveSlot_to: $haveSlotTo, status_ne: $statusNotEquals, status_in: $statusIn, status_equals: $status, attendanceStatus_in: $attendanceStatus, studentAttendanceStatus_in: $studentAttendanceStatus, teacherAttendanceStatus_in: $teacherAttendanceStatus, attendanceChecked_exists: $attendanceCheckedExists, haveSlot_in: $haveSlotIn, passedSessionIndex: $passedSessionIndex, unpassedSessionIndex: $unpassedSessionIndex, pageIndex: $pageIndex, itemsPerPage: $itemsPerPage, orderBy: $orderBy, comments: $comments, openStatus: $openStatus}) {
    data {
      id
      name
      level
      course {
        id
        name
        shortName
        __typename
      }
      classSites {
        _id
        name
        __typename
      }
      startDate
      endDate
      status
      centre {
        id
        name
        shortName
        __typename
      }
      openingRoomNo
      numberOfSessions
      numberOfSessionsStatus
      sessionHour
      totalHour
      slots {
        _id
        date
        startTime
        endTime
        sessionHour
        summary
        homework
        teachers {
          _id
          teacher {
            id
            username
            code
            fullName
            email
            phoneNumber
            user
            imageUrl
            __typename
          }
          role {
            id
            name
            shortName
            __typename
          }
          isActive
          __typename
        }
        teacherAttendance {
          _id
          teacher {
            id
            username
            code
            fullName
            email
            phoneNumber
            user
            imageUrl
            __typename
          }
          status
          note
          createdBy
          createdAt
          lastModifiedBy
          lastModifiedAt
          __typename
        }
        studentAttendance {
          _id
          student {
            id
            fullName
            phoneNumber
            email
            gender
            imageUrl
            __typename
          }
          status
          comment
          sendCommentStatus
          __typename
        }
        __typename
      }
      students {
        _id
        student {
          id
          customer {
            fullName
            phoneNumber
            email
            facebook
            zalo
            __typename
          }
          __typename
        }
        note
        activeInClass
        createdBy
        createdAt
        __typename
      }
      teachers {
        _id
        teacher {
          id
          username
          code
          fullName
          email
          phoneNumber
          user
          imageUrl
          __typename
        }
        role {
          id
          name
          shortName
          __typename
        }
        isActive
        __typename
      }
      operator {
        id
        username
        displayName
        firstName
        middleName
        lastName
        __typename
      }
      operationMethod {
        id
        name
        __typename
      }
      classOpeningPlanId
      hasSchedule
      scheduleSettings {
        _id
        date
        startTime
        endTime
        repeated
        __typename
      }
      createdBy
      createdAt
      lastModifiedBy
      lastModifiedAt
      __typename
    }
    pagination {
      type
      total
      __typename
    }
    __typename
  }
}`,

    GET_CLASS_BY_ID_QUERY: `query GetClassById($id: ID!) {
  classesById(id: $id) {
    id
    name
    level
    rejectNote
    course {
      id
      name
      shortName
      isActive
      numberOfSession
      sessionHour
      description
      minStudents
      maxEnrollSession
      maxStudents
      optimalStudents
      courseProcess {
        id
        isActive
        alwaysShowDefault
        defaultCommentAreas {
          id
          name
          translations {
            key
            value
            locale
            __typename
          }
          fieldName
          type
          slots
          rates {
            value
            commentSamples
            __typename
          }
          sortOrder
          isActive
          isPublic
          isRequired
          guideline
          __typename
        }
        __typename
      }
      __typename
    }
    startDate
    endDate
    status
    centre {
      id
      name
      shortName
      __typename
    }
    openingRoomNo
    numberOfSessions
    numberOfSessionsStatus
    sessionHour
    totalHour
    slots {
      _id
      date
      startTime
      endTime
      index
      sessionHour
      teachers {
        _id
        teacher {
          id
          username
          code
          fullName
          __typename
        }
        role {
          id
          name
          shortName
          __typename
        }
        isActive
        __typename
      }
      studentAttendance {
        _id
        student {
          id
          fullName
          phoneNumber
          email
          gender
          imageUrl
          __typename
        }
        commentStatus {
          feedback
          status
          version
          __typename
        }
        comment
        sendCommentStatus
        status
        commentByAreas {
          grade
          content
          commentAreaId
          type
          __typename
        }
        __typename
      }
      summary
      homework
      learningLessonId
      __typename
    }
    students {
      _id
      student {
        id
        fullName
        status
        __typename
      }
      activeInClass
      classSite {
        _id
        name
        __typename
      }
      __typename
    }
    classSites {
      _id
      name
      __typename
    }
    courseProcessId
    courseProcess {
      id
      isActive
      alwaysShowDefault
      defaultCommentAreas {
        id
        name
        fieldName
        type
        slots
        sortOrder
        isActive
        isPublic
        isRequired
        __typename
      }
      __typename
    }
    __typename
  }
}`,

    FIND_ALL_WITH_CLASS_QUERY: `query FindAllWithClass($payload: StudentMakeupCommentFilterWithClassInput) {
  findAllWithClass(payload: $payload) {
    id
    classId
    sessionId
    classSiteId
    classMakeupId
    sessionMakeupId
    classSiteMakeupId
    status
    studentId
    content
    sendCommentStatus
    commentStatus {
      status
      version
      feedback
      __typename
    }
    attendance {
      attendanceId
      status
      __typename
    }
    commentByAreas {
      commentAreaId
      grade
      content
      __typename
    }
    __typename
  }
}`,

    UPDATE_SLOT_COMMENT_MUTATION: `mutation UpdateSlotComment($payload: UpdateSlotCommentCommand!) {
  classes {
    updateSlotComment(payload: $payload) {
      id
      name
      slots {
        _id
        date
        startTime
        endTime
        sessionHour
        studentAttendance {
          _id
          student {
            id
            fullName
            __typename
          }
          comment
          sendCommentStatus
          status
          commentByAreas {
            grade
            content
            commentAreaId
            type
            __typename
          }
          commentStatus {
            feedback
            status
            version
            __typename
          }
          __typename
        }
        summary
        homework
        index
        __typename
      }
      __typename
    }
    __typename
  }
}`
  };

  globalThis.LMS_GRAPHQL_QUERIES = LMS_GRAPHQL_QUERIES;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = LMS_GRAPHQL_QUERIES;
  }
})();
